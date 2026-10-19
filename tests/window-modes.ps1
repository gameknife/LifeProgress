$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LifeProgressWindowQA {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
}
'@
$taskWindow = [LifeProgressWindowQA]::FindWindow('Tauri Window', 'Life Progress')
if ($taskWindow -eq [IntPtr]::Zero) { throw 'Life Progress window not found' }
$taskPreviousForeground = [LifeProgressWindowQA]::GetForegroundWindow()
function Get-TaskStyle { [LifeProgressWindowQA]::GetWindowLongPtr($taskWindow, -20).ToInt64() }
function Assert-TaskCentered {
    $taskRect = New-Object LifeProgressWindowQA+Rect
    $taskMonitor = New-Object LifeProgressWindowQA+MonitorInfo
    $taskMonitor.Size = [Runtime.InteropServices.Marshal]::SizeOf($taskMonitor)
    if (![LifeProgressWindowQA]::GetWindowRect($taskWindow, [ref]$taskRect)) { throw 'Cannot read window rectangle' }
    if (![LifeProgressWindowQA]::GetMonitorInfo([LifeProgressWindowQA]::MonitorFromWindow($taskWindow, 2), [ref]$taskMonitor)) { throw 'Cannot read monitor work area' }
    if ([Math]::Abs(($taskRect.Left + $taskRect.Right) - ($taskMonitor.Work.Left + $taskMonitor.Work.Right)) -gt 2 -or
        [Math]::Abs(($taskRect.Top + $taskRect.Bottom) - ($taskMonitor.Work.Top + $taskMonitor.Work.Bottom)) -gt 2) { throw 'Window is not centered in monitor work area' }
}
function Send-TaskHotkey {
    [LifeProgressWindowQA]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [LifeProgressWindowQA]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [LifeProgressWindowQA]::keybd_event(0x4C, 0, 0, [UIntPtr]::Zero)
    [LifeProgressWindowQA]::keybd_event(0x4C, 0, 2, [UIntPtr]::Zero)
    [LifeProgressWindowQA]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [LifeProgressWindowQA]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
}
function Wait-TaskMode([bool] $interactive) {
    for ($taskAttempt = 0; $taskAttempt -lt 60; $taskAttempt++) {
        $taskStyle = Get-TaskStyle
        $taskPassThrough = ($taskStyle -band 0x20) -ne 0
        $taskOnTop = ($taskStyle -band 0x8) -ne 0
        if (($interactive -and !$taskPassThrough -and $taskOnTop) -or (!$interactive -and $taskPassThrough -and !$taskOnTop)) { return $taskStyle }
        Start-Sleep -Milliseconds 50
    }
    throw "Mode did not change. Interactive=$interactive style=$taskStyle"
}
$taskSilentStyle = Wait-TaskMode $false
Assert-TaskCentered
Send-TaskHotkey
$taskEditStyle = Wait-TaskMode $true
Start-Sleep -Milliseconds 200
$taskForeground = [LifeProgressWindowQA]::GetForegroundWindow() -eq $taskWindow
if (!$taskForeground) { throw 'Global hotkey failed to focus the editing window' }
Send-TaskHotkey
$taskFinalStyle = Wait-TaskMode $false
Assert-TaskCentered
[LifeProgressWindowQA]::SetForegroundWindow($taskPreviousForeground) | Out-Null
[pscustomobject]@{
    SilentExtendedStyle = ('0x{0:X}' -f $taskSilentStyle)
    EditingExtendedStyle = ('0x{0:X}' -f $taskEditStyle)
    ReturnedSilentStyle = ('0x{0:X}' -f $taskFinalStyle)
    GlobalHotkeyFocusedWindow = $taskForeground
    ClickThroughAndTopmostTransitionsPassed = $true
    CenteredInMonitorWorkArea = $true
} | ConvertTo-Json
