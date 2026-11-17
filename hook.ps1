# Global keyboard listener (WH_KEYBOARD_LL) + foreground-app reporter.
# Passive: reads key state only. Never sends input, never touches the game process.
param(
    [int]$Vk = 0x45,      # E - Fortnite interact key
    [int]$FgMs = 1000     # foreground app report interval
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class KbHookHost {
    public delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN    = 0x0100;
    const int WM_KEYUP      = 0x0101;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_SYSKEYUP   = 0x0105;

    public static IntPtr Hook = IntPtr.Zero;
    public static int TargetVk = 0x45;
    static LowLevelProc _proc;
    static bool _downSent = false;

    static void Emit(string s) {
        Console.Out.WriteLine(s);
        Console.Out.Flush();
    }

    static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            bool down = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
            bool up   = (msg == WM_KEYUP   || msg == WM_SYSKEYUP);
            if (down || up) {
                int vk = Marshal.ReadInt32(lParam);
                if (vk == TargetVk) {
                    // key repeat floods WM_KEYDOWN; only emit the first
                    if (down && !_downSent) { _downSent = true; Emit("DOWN"); }
                    else if (up)            { _downSent = false; Emit("UP"); }
                }
            }
        }
        return CallNextHookEx(Hook, nCode, wParam, lParam);
    }

    public static void Install(int vk) {
        TargetVk = vk;
        _proc = Callback;
        Hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        Emit(Hook != IntPtr.Zero ? "HOOKED" : "HOOKFAIL");
    }

    public static void Shutdown() {
        if (Hook != IntPtr.Zero) { UnhookWindowsHookEx(Hook); Hook = IntPtr.Zero; }
    }

    public static int GetFgPid() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return (int)pid;
    }
}
"@

[KbHookHost]::Install($Vk)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $FgMs
$timer.Add_Tick({
    try {
        $pid2 = [KbHookHost]::GetFgPid()
        if ($pid2 -gt 0) {
            $p = Get-Process -Id $pid2 -ErrorAction Stop
            [Console]::Out.WriteLine("FG:" + $p.ProcessName)
            [Console]::Out.Flush()
        }
    } catch { }
})
$timer.Start()

# message pump keeps the hook thread alive
[System.Windows.Forms.Application]::Run()
