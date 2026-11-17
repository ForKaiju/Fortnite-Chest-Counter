# chest-probe.ps1 — passive screen watcher.
# Captures two crops of the game screen and reads them with Windows OCR:
#   1. the interact-prompt area  → arms the chest counter
#   2. the prize-reveal area     → feeds auto-Found for Pirate Treasure wins
# Listens only: takes no input, reads no game memory, injects nothing — the
# same pixels a player sees with their eyes.
# Output protocol (one line per event):
#   READY        OCR engine up
#   PROMPT:1     chest prompt text detected on screen
#   PROMPT:0     no chest prompt detected
#   PRIZE:<text> readable text in the reveal region (whitespace collapsed)
#   OCRFAIL      engine could not start / capture unavailable
param(
    [double]$CropX = 0.28,        # prompt crop, fractions of the virtual screen
    [double]$CropY = 0.50,
    [double]$CropW = 0.44,
    [double]$CropH = 0.28,
    [double]$PrizeX = 0.15,       # reveal-banner crop, generously wide — the
    [double]$PrizeY = 0.18,       # banner is centred and covers a lot of screen
    [double]$PrizeW = 0.70,
    [double]$PrizeH = 0.64,
    [int]$IntervalMs = 250,
    [int]$MaxFrameW = 1000,       # downscale cap so OCR stays fast on 4K
    [int]$PrizeEvery = 4,         # prize OCR every Nth tick (~1 s at 250 ms)
    [int]$PrizeMaxFrameW = 720,   # bigger crop → smaller cap, same OCR cost
    [int]$PrizeMinChars = 8,
    [int]$PrizeRepeatMs = 60000   # re-offer identical text this often at most
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type -AssemblyName System.Windows.Forms | Out-Null
# WinRT projection support — makes IAsyncOperation awaitable from PS 5.1
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ProbeCap {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    public struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
}
"@

# WinRT type projections (OCR lives in Windows.Media.Ocr on Win10/11)
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]

# generic IAsyncOperation -> Task adapter for PowerShell
function Await($op, $resultType) {
    $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    if (-not $m) { return $null }
    $t = $m.MakeGenericMethod($resultType).Invoke($null, @($op))
    if (-not $t.Wait([int]($IntervalMs * 6))) { return $null }   # never hang the loop
    return $t.Result
}

function Get-OcrEngine {
    # direct en-US first — TryCreateFromUserProfileLanguages is null when the
    # user's language list has no OCR-capable entry (common on stripped setups)
    try {
        $lang = New-Object Windows.Globalization.Language('en-US')
        $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
        if ($ocr) { return $ocr }
    } catch {}
    return [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}

# One screen region -> recognised text. Returns $null when the pixels could not
# be read at all, so the caller can tell "nothing there" from "capture broke".
function Read-Region([double]$fx, [double]$fy, [double]$fw, [double]$fh, [int]$capW) {
    [ProbeCap]::SetProcessDPIAware() | Out-Null
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen -as [System.Drawing.Rectangle]
    $rx = [int]($vs.X + $vs.Width * $fx)
    $ry = [int]($vs.Y + $vs.Height * $fy)
    $rw = [int]($vs.Width * $fw)
    $rh = [int]($vs.Height * $fh)
    if ($rw -lt 40 -or $rh -lt 40) { return $null }

    $bmp = New-Object System.Drawing.Bitmap($rw, $rh)
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($rx, $ry, 0, 0, $bmp.Size) } finally { $g.Dispose() }

        # downscale large crops for OCR speed
        if ($bmp.Width -gt $capW) {
            $scale = [double]$capW / $bmp.Width
            $small = New-Object System.Drawing.Bitmap([int]($bmp.Width * $scale), [int]($bmp.Height * $scale))
            $g2 = [System.Drawing.Graphics]::FromImage($small)
            try {
                $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g2.DrawImage($bmp, 0, 0, $small.Width, $small.Height)
            } finally { $g2.Dispose() }
            $bmp.Dispose(); $bmp = $small
        }

        # raw BGRA pixels -> IBuffer -> SoftwareBitmap (no encoder round-trip)
        $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
        $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $stride = $data.Stride
        $pixelW = $bmp.Width; $pixelH = $bmp.Height
        $raw = New-Object byte[] ($stride * $pixelH)
        try {
            [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
        } finally { $bmp.UnlockBits($data) }

        if ($stride -eq $pixelW * 4) {
            $pix = $raw
        } else {
            # copy row-by-row when the GDI stride is padded
            $pix = New-Object byte[] ($pixelW * 4 * $pixelH)
            for ($row = 0; $row -lt $pixelH; $row++) {
                [Array]::Copy($raw, $row * $stride, $pix, $row * $pixelW * 4, $pixelW * 4)
            }
        }
        $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($pix)
        $soft = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer(
            $buffer,
            [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
            $pixelW, $pixelH,
            [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)

        $result = Await ($ocr.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
        if (-not $result) { return $null }
        return [string]$result.Text
    } finally {
        if ($bmp) { $bmp.Dispose() }
    }
}

# OCR output is multi-line and can carry junk glyphs. Collapse it to one line
# so the stdout protocol stays one event per line.
function Format-PrizeText([string]$text) {
    if (-not $text) { return '' }
    $t = $text -replace '[^\p{L}\p{N}\p{P}\p{Z}\s]', ' '
    $t = ($t -replace '\s+', ' ').Trim()
    if ($t.Length -gt 240) { $t = $t.Substring(0, 240) }
    return $t
}

$ocr = Get-OcrEngine
if (-not $ocr) { Write-Output 'OCRFAIL'; exit 1 }
Write-Output 'READY'

$lastState = -1
$lastPrize = ''
$lastPrizeAt = 0
$tick = 0
while ($true) {
    try {
        $text = Read-Region $CropX $CropY $CropW $CropH $MaxFrameW
        if ($null -eq $text) { throw 'capture failed' }

        # the chest prompt reads "Search Chest" — arm on chest/treasure text
        $state = if ($text -match '(?i)chest|treasure') { 1 } else { 0 }
        if ($state -ne $lastState) {
            $lastState = $state
            Write-Output "PROMPT:$state"
        }
    } catch {
        # capture/OCR hiccup: report off once, keep looping
        if ($lastState -ne 0) { $lastState = 0; Write-Output 'PROMPT:0' }
    }

    # prize reveal pass — slower cadence, own region, own debounce
    $tick++
    if ($PrizeEvery -gt 0 -and ($tick % $PrizeEvery) -eq 0) {
        try {
            $raw = Read-Region $PrizeX $PrizeY $PrizeW $PrizeH $PrizeMaxFrameW
            if ($raw) {
                $line = Format-PrizeText $raw
                $letters = ([regex]::Matches($line, '[A-Za-z]')).Count
                if ($line.Length -ge $PrizeMinChars -and $letters -ge 3) {
                    $now = [DateTime]::UtcNow.Ticks / 10000
                    # same banner frame repeated: stay quiet until it changes or
                    # the repeat window expires (server re-checks with a cooldown)
                    if ($line -ne $lastPrize -or ($now - $lastPrizeAt) -ge $PrizeRepeatMs) {
                        $lastPrize = $line
                        $lastPrizeAt = $now
                        Write-Output "PRIZE:$line"
                    }
                }
            }
        } catch {
            # a broken prize pass must never stop the prompt watcher
        }
    }

    Start-Sleep -Milliseconds $IntervalMs
}
