# Asset pipeline:
#  1. banner-rgb.png (F-scroll banner with baked checkerboard) -> flood-fill border-connected
#     light checker pixels to true transparency -> public/assets/banner.png
#  2. chest.png -> public/assets/chest.png (straight copy)
#  3. chest.png -> alpha-bbox crop, square pad, multi-size ICO -> build/icon.ico
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class AssetTools {
    // Border-connected flood fill: kills the fake checkerboard without touching
    // interior whites (the F letters) since the banner has a closed dark outline.
    public static Bitmap KillChecker(Bitmap src) {
        Bitmap bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, src.Width, src.Height);
        int w = bmp.Width, h = bmp.Height;
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = d.Stride;
        byte[] px = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(d.Scan0, px, 0, px.Length);
        bool[] kill = new bool[w * h];
        Queue<int> q = new Queue<int>();
        Func<int, bool> isChecker = (i) => {
            int o = i * 4;
            int b = px[o], g2 = px[o + 1], r = px[o + 2];
            int mn = Math.Min(r, Math.Min(g2, b)), mx = Math.Max(r, Math.Max(g2, b));
            return mn > 150 && (mx - mn) < 22;
        };
        // pass 2 rule: catches darker checker remnants; parchment/gold have spread > 45,
        // the dark outline has low min-channel — neither matches
        Func<int, bool> isRemnant = (i) => {
            int o = i * 4;
            int b = px[o], g2 = px[o + 1], r = px[o + 2];
            int mn = Math.Min(r, Math.Min(g2, b)), mx = Math.Max(r, Math.Max(g2, b));
            return mn > 100 && (mx - mn) < 45;
        };
        for (int x = 0; x < w; x++) { Try(x, isChecker, kill, q, w, h); Try((h - 1) * w + x, isChecker, kill, q, w, h); }
        for (int y = 0; y < h; y++) { Try(y * w, isChecker, kill, q, w, h); Try(y * w + w - 1, isChecker, kill, q, w, h); }
        while (q.Count > 0) {
            int i = q.Dequeue();
            int x = i % w, y = i / w;
            if (x > 0) Try(i - 1, isChecker, kill, q, w, h);
            if (x < w - 1) Try(i + 1, isChecker, kill, q, w, h);
            if (y > 0) Try(i - w, isChecker, kill, q, w, h);
            if (y < h - 1) Try(i + w, isChecker, kill, q, w, h);
        }
        // frontier expansion: islands of checker remnant sit next to already-killed
        // pixels; grow into them repeatedly until nothing new matches
        for (int iter = 0; iter < 12; iter++) {
            Queue<int> seeds = new Queue<int>();
            for (int i = 0; i < w * h; i++) {
                if (kill[i]) continue;
                if (!isRemnant(i)) continue;
                int x = i % w, y = i / w;
                bool nearKilled =
                    (x > 0 && kill[i - 1]) || (x < w - 1 && kill[i + 1]) ||
                    (y > 0 && kill[i - w]) || (y < h - 1 && kill[i + w]);
                if (nearKilled) seeds.Enqueue(i);
            }
            if (seeds.Count == 0) break;
            while (seeds.Count > 0) {
                int i = seeds.Dequeue();
                if (kill[i]) continue;
                kill[i] = true;
                int x = i % w, y = i / w;
                if (x > 0) Try(i - 1, isRemnant, kill, seeds, w, h);
                if (x < w - 1) Try(i + 1, isRemnant, kill, seeds, w, h);
                if (y > 0) Try(i - w, isRemnant, kill, seeds, w, h);
                if (y < h - 1) Try(i + w, isRemnant, kill, seeds, w, h);
            }
        }
        for (int i = 0; i < w * h; i++) if (kill[i]) px[i * 4 + 3] = 0;
        System.Runtime.InteropServices.Marshal.Copy(px, 0, d.Scan0, px.Length);
        bmp.UnlockBits(d);
        return bmp;
    }
    static void Try(int i, Func<int, bool> test, bool[] kill, Queue<int> q, int w, int h) {
        if (i < 0 || i >= w * h) return;
        if (kill[i]) return;
        if (!test(i)) return;
        kill[i] = true; q.Enqueue(i);
    }

    public static Rectangle AlphaBBox(Bitmap src, byte minAlpha) {
        int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < src.Height; y++)
            for (int x = 0; x < src.Width; x++)
                if (src.GetPixel(x, y).A >= minAlpha) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
        if (maxX < 0) throw new Exception("image fully transparent");
        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    public static Bitmap Square(Bitmap src) {
        int side = Math.Max(src.Width, src.Height);
        Bitmap sq = new Bitmap(side, side, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(sq)) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(src, (side - src.Width) / 2, (side - src.Height) / 2, src.Width, src.Height);
        }
        return sq;
    }

    public static Bitmap Resize(Bitmap src, int size) {
        Bitmap b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(b)) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, size, size);
        }
        if (size <= 48) Sharpen(b); // thin skull details die in downscale; restore bite
        return b;
    }

    // 3x3 unsharp-ish kernel, keeps alpha untouched
    public static void Sharpen(Bitmap b) {
        int w = b.Width, h = b.Height;
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = d.Stride;
        byte[] px = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(d.Scan0, px, 0, px.Length);
        byte[] src = (byte[])px.Clone();
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int o = y * stride + x * 4;
                for (int c = 0; c < 3; c++) {
                    int center = src[o + c];
                    int sum = src[o - stride + c] + src[o + stride + c] + src[o - 4 + c] + src[o + 4 + c];
                    int v = center + (center * 4 - sum) / 4; // mild unsharp
                    px[o + c] = (byte)(v < 0 ? 0 : v > 255 ? 255 : v);
                }
            }
        }
        System.Runtime.InteropServices.Marshal.Copy(px, 0, d.Scan0, px.Length);
        b.UnlockBits(d);
    }

    // BMP-format ICO entry (32bpp BGRA bottom-up + empty AND mask)
    public static byte[] BmpEntry(Bitmap b) {
        int w = b.Width, h = b.Height;
        int rowXor = w * 4;
        int rowAnd = ((w + 31) / 32) * 4;
        int maskSize = rowAnd * h;
        int dataSize = 40 + rowXor * h + maskSize;
        byte[] outp = new byte[dataSize];
        // BITMAPINFOHEADER, biHeight = 2*h (XOR + AND)
        WriteInt(outp, 0, 40); WriteInt(outp, 4, w); WriteInt(outp, 8, h * 2);
        outp[12] = 1; outp[14] = 32;          // planes, bitcount
        WriteInt(outp, 16, 0);                 // biCompression = BI_RGB
        WriteInt(outp, 20, rowXor * h);        // biSizeImage
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] src = new byte[Math.Abs(d.Stride) * h];
        System.Runtime.InteropServices.Marshal.Copy(d.Scan0, src, 0, src.Length);
        b.UnlockBits(d);
        int dstBase = 40;
        for (int y = 0; y < h; y++) {
            int srcRow = y * Math.Abs(d.Stride);
            int dstRow = dstBase + (h - 1 - y) * rowXor; // bottom-up
            for (int x = 0; x < w; x++) {
                int s = srcRow + x * 4, t = dstRow + x * 4;
                outp[t] = src[s]; outp[t + 1] = src[s + 1]; outp[t + 2] = src[s + 2]; outp[t + 3] = src[s + 3]; // BGRA passthrough
            }
        }
        return outp;
    }

    static void WriteInt(byte[] b, int o, int v) {
        b[o] = (byte)v; b[o + 1] = (byte)(v >> 8); b[o + 2] = (byte)(v >> 16); b[o + 3] = (byte)(v >> 24);
    }

    public static void WriteIco(string path, Bitmap square) {
        int[] sizes = new int[] { 16, 24, 32, 48, 64, 128, 256 };
        List<byte[]> blobs = new List<byte[]>();
        List<int> dims = new List<int>();
        foreach (int s in sizes) {
            using (Bitmap r = Resize(square, s)) {
                if (s == 256) {
                    using (MemoryStream ms = new MemoryStream()) { r.Save(ms, ImageFormat.Png); blobs.Add(ms.ToArray()); }
                } else {
                    blobs.Add(BmpEntry(r));
                }
                dims.Add(s);
            }
        }
        using (FileStream fs = new FileStream(path, FileMode.Create)) {
            BinaryWriter bw = new BinaryWriter(fs);
            bw.Write((ushort)0); bw.Write((ushort)1); bw.Write((ushort)blobs.Count);
            int offset = 6 + 16 * blobs.Count;
            for (int i = 0; i < blobs.Count; i++) {
                int s = dims[i];
                bw.Write((byte)(s >= 256 ? 0 : s));
                bw.Write((byte)(s >= 256 ? 0 : s));
                bw.Write((byte)0); bw.Write((byte)0);
                bw.Write((ushort)1); bw.Write((ushort)32);
                bw.Write(blobs[i].Length);
                bw.Write(offset);
                offset += blobs[i].Length;
            }
            foreach (byte[] blob in blobs) bw.Write(blob);
            bw.Flush();
        }
    }
}
"@

# 1. banner transparency
$bannerSrc = Join-Path $root 'assets\banner-rgb.png'
$bannerOut = Join-Path $root 'public\assets\banner.png'
New-Item -ItemType Directory -Force (Split-Path $bannerOut) | Out-Null
$src = [System.Drawing.Bitmap]::FromFile($bannerSrc)
$clean = [AssetTools]::KillChecker($src)
$clean.Save($bannerOut, [System.Drawing.Imaging.ImageFormat]::Png)
$clean.Dispose(); $src.Dispose()
Write-Host "banner -> $bannerOut"

# 2. chest copy
$chestSrc = Join-Path $root 'assets\chest.png'
$chestOut = Join-Path $root 'public\assets\chest.png'
Copy-Item $chestSrc $chestOut -Force
Write-Host "chest -> $chestOut"

# 3. icon.ico
$chest = [System.Drawing.Bitmap]::FromFile($chestSrc)
$bbox = [AssetTools]::AlphaBBox($chest, 16)
$crop = $chest.Clone($bbox, $chest.PixelFormat)
$sq = [AssetTools]::Square($crop)
[AssetTools]::WriteIco((Join-Path $root 'build\icon.ico'), $sq)
$sq.Dispose(); $crop.Dispose(); $chest.Dispose()
Write-Host "icon.ico rebuilt"
