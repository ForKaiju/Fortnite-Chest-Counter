// portable-sfx.cs — single-file distributor for Chest Counter.
//
// A plain "Chest Counter.exe" cannot run on its own: the app needs its
// resources\ tree (public/, replay-reader/, the PowerShell watchers, the
// bundled Electron runtime). This stub carries the release zip appended to
// itself, unpacks it once into %LOCALAPPDATA%\Chest Counter Portable, and
// launches the real executable from there.
//
// File layout of the produced exe:
//   [ this compiled stub ][ append.<zip bytes> ][ 8-byte little-endian offset ]
//
// The offset is the distance from byte 0 to the first zip byte, so the stub
// never has to search for a signature inside its own image.
//
// Built by build-portable.ps1. No install, no admin, no registry.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace ChestCounterPortable
{
    // Read-only window onto a byte range of a bigger file, so ZipArchive can
    // read the appended payload without copying it anywhere first.
    internal sealed class SliceStream : Stream
    {
        private readonly Stream inner;
        private readonly long start;
        private readonly long length;
        private long position;

        public SliceStream(Stream inner, long start, long length)
        {
            this.inner = inner;
            this.start = start;
            this.length = length;
            this.position = 0;
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }

        public override long Position
        {
            get { return position; }
            set
            {
                if (value < 0 || value > length) throw new ArgumentOutOfRangeException("value");
                position = value;
            }
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long left = length - position;
            if (left <= 0) return 0;
            if (count > left) count = (int)left;
            inner.Seek(start + position, SeekOrigin.Begin);
            int read = inner.Read(buffer, offset, count);
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long target;
            if (origin == SeekOrigin.Begin) target = offset;
            else if (origin == SeekOrigin.Current) target = position + offset;
            else target = length + offset;
            Position = target;
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }

    // Borderless "unpacking once" card. Extraction runs on a worker thread;
    // the timer closes the form when that thread ends.
    internal sealed class Splash : Form
    {
        public Splash()
        {
            Text = "Chest Counter";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = true;
            ClientSize = new Size(380, 132);
            BackColor = Color.FromArgb(18, 18, 22);

            var title = new Label();
            title.Text = "Chest Counter";
            title.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(240, 192, 64);
            title.AutoSize = true;
            title.Location = new Point(22, 20);
            Controls.Add(title);

            var sub = new Label();
            sub.Text = "Unpacking for first run - this happens once.";
            sub.Font = new Font("Segoe UI", 9F);
            sub.ForeColor = Color.FromArgb(200, 200, 208);
            sub.AutoSize = true;
            sub.Location = new Point(24, 54);
            Controls.Add(sub);

            var bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 40;
            bar.Location = new Point(24, 86);
            bar.Size = new Size(332, 16);
            Controls.Add(bar);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string self = Assembly.GetExecutingAssembly().Location;
            long payloadStart;
            long payloadLength;

            try
            {
                using (var probe = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (probe.Length < 32)
                    {
                        Fail("This file is truncated - download it again.");
                        return 1;
                    }
                    var footer = new byte[8];
                    probe.Seek(-8, SeekOrigin.End);
                    if (probe.Read(footer, 0, 8) != 8)
                    {
                        Fail("This file is truncated - download it again.");
                        return 1;
                    }
                    payloadStart = BitConverter.ToInt64(footer, 0);
                    payloadLength = probe.Length - 8 - payloadStart;
                }
            }
            catch (Exception ex)
            {
                Fail("Could not read the payload: " + ex.Message);
                return 1;
            }

            if (payloadStart <= 0 || payloadLength <= 0)
            {
                Fail("This file does not carry a Chest Counter payload.");
                return 1;
            }

            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Chest Counter Portable");
            string exe = Path.Combine(root, "Chest Counter.exe");
            string marker = Path.Combine(root, "payload.length");

            bool unpack = true;
            try
            {
                unpack = !File.Exists(exe) ||
                         !File.Exists(marker) ||
                         File.ReadAllText(marker).Trim() != payloadLength.ToString();
            }
            catch (Exception)
            {
                // a stale or locked marker means "unpack again", never a crash
                unpack = true;
            }

            if (unpack)
            {
                Exception failure = null;
                var worker = new Thread(() =>
                {
                    try
                    {
                        Extract(self, payloadStart, payloadLength, root);
                        File.WriteAllText(marker, payloadLength.ToString());
                    }
                    catch (Exception ex)
                    {
                        failure = ex;
                    }
                });
                worker.IsBackground = true;

                using (var splash = new Splash())
                {
                    var timer = new System.Windows.Forms.Timer();
                    timer.Interval = 120;
                    timer.Tick += (sender, e) => { if (!worker.IsAlive) splash.Close(); };
                    timer.Start();
                    worker.Start();
                    Application.Run(splash);
                    timer.Stop();
                    timer.Dispose();
                }

                worker.Join();
                if (failure != null)
                {
                    Fail("Unpacking failed: " + failure.Message);
                    return 1;
                }
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exe,
                    WorkingDirectory = root,
                    UseShellExecute = true,
                });
            }
            catch (Exception ex)
            {
                Fail("Could not start Chest Counter: " + ex.Message);
                return 1;
            }
            return 0;
        }

        private static void Extract(string self, long start, long length, string root)
        {
            Directory.CreateDirectory(root);
            string rootFull = Path.GetFullPath(root).TrimEnd('\\') + "\\";

            using (var file = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var slice = new SliceStream(file, start, length))
            using (var zip = new ZipArchive(slice, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(root, entry.FullName));
                    // an archive that tries to escape the target folder is refused
                    if (!target.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue;
                    if (entry.FullName.EndsWith("/") || entry.Name.Length == 0)
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    string parent = Path.GetDirectoryName(target);
                    if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    entry.ExtractToFile(target, true);
                }
            }
        }

        private static void Fail(string message)
        {
            MessageBox.Show(message, "Chest Counter",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
