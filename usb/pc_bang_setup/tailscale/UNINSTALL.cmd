@echo off
rem USB offline Tailscale uninstaller launcher (no residue).
rem Uses Windows PowerShell 5.1 explicitly. Forwards all args to the .ps1.
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Administrator rights required.
  echo         Right-click UNINSTALL.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-Tailscale.ps1" %*
set CODE=%errorlevel%
echo.
if %CODE% neq 0 (
  echo [RESULT] Uninstall finished with problems, code %CODE%. See tailscale-uninstall.log.
  pause
  exit /b %CODE%
)
echo [RESULT] Uninstall clean, code 0.
echo %cmdcmdline% | find /I "/c" >nul && pause
exit /b 0
