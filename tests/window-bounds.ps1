param([Parameter(Mandatory = $true)][int]$AppProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LifeProgressBoundsQA {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    public static Rect Read(uint processId) {
        IntPtr target = IntPtr.Zero;
        EnumWindows((hwnd, unused) => {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            var title = new StringBuilder(256); GetWindowText(hwnd, title, 256);
            if (pid == processId && title.ToString() == "Life Progress") { target = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        Rect rect;
        if (target == IntPtr.Zero || !GetWindowRect(target, out rect)) throw new Exception("Application window bounds unavailable");
        return rect;
    }
}
'@
[LifeProgressBoundsQA]::Read($AppProcessId) | ConvertTo-Json -Compress
