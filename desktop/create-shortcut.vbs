Option Explicit
' ============================================================
' 创建带自定义图标的快捷方式
' 用法（由 vbs.mjs 调用，共 6 个参数）：
'   create-shortcut.vbs <lnk路径> <目标exe> <命令行参数> <图标路径> <工作目录> <描述>
' 结果以 result=ok / result=error 回传到 stdout。
'
' 注意：
' 1) 本文件保持纯 ASCII —— 脚本宿主按 ANSI 读取 .vbs，直接写中文会乱码；
'    所有中文（含快捷方式名）一律通过参数传入。
' 2) 必须由控制台宿主运行，且**不要**加 //B —— 批处理模式会把 Echo 的 stdout 一并吞掉，
'    调用方将收不到任何回传（实测结论）。
' ============================================================

Dim sh, fso, args, lnkPath, targetPath, cmdArgs, iconPath, workDir, descr

Set sh   = CreateObject("WScript.Shell")
Set fso  = CreateObject("Scripting.FileSystemObject")
Set args = WScript.Arguments

If args.Count < 6 Then
  WScript.Echo "result=error"
  WScript.Echo "reason=need 6 args, got " & args.Count
  WScript.Quit 2
End If

lnkPath    = args(0)
targetPath = args(1)
cmdArgs    = args(2)
iconPath   = args(3)
workDir    = args(4)
descr      = args(5)

If Not fso.FileExists(targetPath) Then
  WScript.Echo "result=error"
  WScript.Echo "reason=target not found"
  WScript.Quit 3
End If

On Error Resume Next
Dim lnk
Set lnk = sh.CreateShortcut(lnkPath)
If Err.Number <> 0 Then
  WScript.Echo "result=error"
  WScript.Echo "reason=CreateShortcut: " & Err.Description
  WScript.Quit 4
End If

lnk.TargetPath       = targetPath
lnk.Arguments        = cmdArgs
lnk.WorkingDirectory = workDir
lnk.Description      = descr
lnk.WindowStyle      = 1
If Len(iconPath) > 0 Then
  If fso.FileExists(iconPath) Then
    lnk.IconLocation = iconPath & ",0"
  End If
End If
lnk.Save

If Err.Number <> 0 Then
  WScript.Echo "result=error"
  WScript.Echo "reason=Save: " & Err.Description
  WScript.Quit 5
End If
On Error GoTo 0

WScript.Echo "result=ok"
WScript.Echo "lnk_exists=" & fso.FileExists(lnkPath)
If fso.FileExists(lnkPath) Then
  WScript.Echo "lnk_size=" & fso.GetFile(lnkPath).Size
End If
WScript.Echo "icon_set=" & (Len(iconPath) > 0 And fso.FileExists(iconPath))
WScript.Quit 0
