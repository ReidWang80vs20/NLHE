# Locate a window by title substring -> screenshot that window -> send WM_CLOSE.
# Only touches the window whose title matches; other windows/tabs are untouched.
#
# NOTE: this file must stay PURE ASCII. PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# so non-ASCII comments corrupt the following tokens and produce bogus syntax errors
# (e.g. "unexpected token ')'" pointing at an innocent param block).
#
# Capture strategy: PrintWindow(hWnd, 0x2) grabs the window's OWN rendered content,
# so it works even when the window is occluded or refused foreground. CopyFromScreen
# is only a fallback, and only when the window verifiably owns the foreground --
# a screen grab of an occluded window silently captures the desktop wallpaper and
# produces a screenshot that "looks saved" while proving nothing.
param(
  [string]$Match = "NLHE",
  [string]$Out = "shot.png",
  [int]$Close = 1
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint nFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
}
"@

$proc = Get-Process |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$Match*" } |
  Select-Object -First 1

if (-not $proc) {
  Write-Output "found=0"
  exit 1
}

$h = $proc.MainWindowHandle
$r = New-Object W+RECT
[void][W]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top

# Emit one key=value per line: the caller parses with indexOf('='), so packing
# multiple fields on one line would make the value swallow the following keys.
Write-Output "found=1"
Write-Output ("pid=" + $proc.Id)
Write-Output ("rect=" + $r.Left + "," + $r.Top + " " + $w + "x" + $hgt)
Write-Output ("title=" + $proc.MainWindowTitle)

# A MAXIMIZED window legitimately reports a rect that sticks out past the screen on
# all four sides: GetWindowRect includes the invisible resize border
# (SM_CXSIZEFRAME + SM_CXPADDEDBORDER) that Windows uses for edge-snapping. Measured
# here: 1440x912 work area -> rect (-7,-7) 1453x925, i.e. ~7px out on each side, with
# nothing actually hidden. So emit both facts and let the caller derive its tolerance
# instead of hard-coding a magic number (or, worse, reporting a false failure).
# NOTE: Chrome's own window.outerWidth/outerHeight (CSS px) do NOT include this
# border, so the CDP probe and this Win32 probe differ by exactly this amount -- both
# are right about their own coordinate space.
Write-Output ("zoomed=" + $(if ([W]::IsZoomed($h)) { "1" } else { "0" }))
Write-Output ("frameborder=" + ([W]::GetSystemMetrics(32) + [W]::GetSystemMetrics(92)))

# Screen/work-area, plus the window's own outer edges, so the caller can check
# "is the window bigger than the screen?" directly. That was a real defect:
# a hard-coded --window-size=1560,980 on a 1440x960 screen produced a 1455x975
# window at (10,10) -- 25px off the right edge, 73px below the bottom -- which
# looked like "content is covered / misaligned" rather than an error.
try {
  Add-Type -AssemblyName System.Windows.Forms
  $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  Write-Output ("screen=" + $sb.Width + "x" + $sb.Height)
  Write-Output ("workarea=" + $wa.Width + "x" + $wa.Height)
  Write-Output ("outerright=" + $r.Right)
  Write-Output ("outerbottom=" + $r.Bottom)
} catch {
  Write-Output ("screeninfo_failed=" + $_.Exception.Message)
}

# Count distinct sampled colours. A window that rendered nothing (or a failed grab)
# yields a near-uniform image; real UI content yields many distinct colours.
function Get-Variety($bmp, $width, $height) {
  $set = New-Object 'System.Collections.Generic.HashSet[int]'
  $stepX = [Math]::Max(1, [int]($width / 40))
  $stepY = [Math]::Max(1, [int]($height / 40))
  for ($y = 0; $y -lt $height; $y += $stepY) {
    for ($x = 0; $x -lt $width; $x += $stepX) {
      [void]$set.Add($bmp.GetPixel($x, $y).ToArgb())
    }
  }
  return $set.Count
}

if ($w -gt 0 -and $hgt -gt 0) {
  try {
    if ([W]::IsIconic($h)) { [void][W]::ShowWindow($h, 9) }   # 9 = SW_RESTORE
    Start-Sleep -Milliseconds 1200

    # --- 1st choice: grab the window's own content, occlusion-proof ---
    $bmp = New-Object System.Drawing.Bitmap $w, $hgt
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [W]::PrintWindow($h, $hdc, 2)   # 2 = PW_RENDERFULLCONTENT (needed for GPU-composited Chrome)
    $g.ReleaseHdc($hdc)
    $variety = Get-Variety $bmp $w $hgt
    $mode = "printwindow"

    if ((-not $ok) -or ($variety -lt 25)) {
      # --- 2nd choice: plain screen grab, valid only if we truly own the foreground ---
      $g.Dispose(); $bmp.Dispose()
      # AttachThreadInput is the documented way around the foreground lock: it lets a
      # background process take focus from the current foreground thread.
      $fg = [W]::GetForegroundWindow()
      $myThread = [W]::GetCurrentThreadId()
      $fgThread = [W]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
      if ($fgThread -ne 0 -and $fgThread -ne $myThread) {
        [void][W]::AttachThreadInput($myThread, $fgThread, $true)
        [void][W]::BringWindowToTop($h)
        [void][W]::SetForegroundWindow($h)
        [void][W]::AttachThreadInput($myThread, $fgThread, $false)
      } else {
        [void][W]::BringWindowToTop($h)
        [void][W]::SetForegroundWindow($h)
      }
      Start-Sleep -Milliseconds 1600

      $bmp = New-Object System.Drawing.Bitmap $w, $hgt
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $hgt))
      $variety = Get-Variety $bmp $w $hgt
      $mode = "copyscreen"
    }

    Write-Output ("shotmode=" + $mode)
    Write-Output ("variety=" + $variety)
    $fgNow = [W]::GetForegroundWindow()
    Write-Output ("foreground=" + $(if ($fgNow -eq $h) { "1" } else { "0" }))

    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("saved=" + $Out)
  } catch {
    Write-Output ("shot_failed=" + $_.Exception.Message)
  }
}

if ($Close -eq 1) {
  [void][W]::SendMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output "closed=1"
}
