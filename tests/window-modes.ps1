$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LifeProgressWindowQA {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
}
'@
$taskWindow = [LifeProgressWindowQA]::FindWindow('Tauri Window', 'Life Progress')
if ($taskWindow -eq [IntPtr]::Zero) { throw 'Life Progress window not found' }
$taskPreviousForeground = [LifeProgressWindowQA]::GetForegroundWindow()
function Get-TaskStyle { [LifeProgressWindowQA]::GetWindowLongPtr($taskWindow, -20).ToInt64() }
function Get-TaskBounds {
    $taskRect = New-Object LifeProgressWindowQA+Rect
    if (![LifeProgressWindowQA]::GetWindowRect($taskWindow, [ref]$taskRect)) { throw 'Cannot read window rectangle' }
    $taskRect | ConvertTo-Json -Compress
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
function Wait-TaskEditingWindow {
    for ($taskAttempt = 0; $taskAttempt -lt 60; $taskAttempt++) {
        $taskStyle = Get-TaskStyle
        if (($taskStyle -band 0x20) -eq 0 -and ($taskStyle -band 0x8) -ne 0 -and
            [LifeProgressWindowQA]::IsWindowVisible($taskWindow) -and
            ![LifeProgressWindowQA]::IsIconic($taskWindow) -and
            [LifeProgressWindowQA]::GetForegroundWindow() -eq $taskWindow) { return $taskStyle }
        Start-Sleep -Milliseconds 50
    }
    throw 'Global hotkey failed to restore and focus the editing window'
}
$taskSilentStyle = Wait-TaskMode $false
$taskBounds = Get-TaskBounds
Send-TaskHotkey
$taskEditStyle = Wait-TaskEditingWindow
# Restoring must work even while the runtime still considers the window editable.
[LifeProgressWindowQA]::ShowWindow($taskWindow, 6) | Out-Null
if (![LifeProgressWindowQA]::IsIconic($taskWindow)) { throw 'Failed to minimize the test window' }
Send-TaskHotkey
$null = Wait-TaskEditingWindow
[LifeProgressWindowQA]::ShowWindow($taskWindow, 0) | Out-Null
if ([LifeProgressWindowQA]::IsWindowVisible($taskWindow)) { throw 'Failed to hide the test window' }
Send-TaskHotkey
$null = Wait-TaskEditingWindow
if ($taskPreviousForeground -ne [IntPtr]::Zero -and $taskPreviousForeground -ne $taskWindow) {
    [LifeProgressWindowQA]::SetForegroundWindow($taskPreviousForeground) | Out-Null
    if ([LifeProgressWindowQA]::GetForegroundWindow() -eq $taskWindow) { throw 'Failed to unfocus the test window' }
    Send-TaskHotkey
    $null = Wait-TaskEditingWindow
}
Send-TaskHotkey
$taskFinalStyle = Wait-TaskMode $false
if ((Get-TaskBounds) -ne $taskBounds) { throw 'Mode transition changed window bounds' }
[LifeProgressWindowQA]::SetForegroundWindow($taskPreviousForeground) | Out-Null
[pscustomobject]@{
    SilentExtendedStyle = ('0x{0:X}' -f $taskSilentStyle)
    EditingExtendedStyle = ('0x{0:X}' -f $taskEditStyle)
    ReturnedSilentStyle = ('0x{0:X}' -f $taskFinalStyle)
    GlobalHotkeyFocusedWindow = $true
    HiddenAndMinimizedRecoveryPassed = $true
    ClickThroughAndTopmostTransitionsPassed = $true
    WindowBoundsUnchanged = $true
} | ConvertTo-Json
