@echo off
rem pc_bang_setup root launcher: installs BOTH Tailscale and Orca, then
rem connects Orca to the desktop. Delegates to orca\Orca-Session.ps1.
rem Uses Windows PowerShell 5.1 explicitly. Forwards all args.
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Administrator rights required.
  echo         Right-click SETUP.cmd and choose "Run as administrator".
  pause
  exit /b 3
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0orca\Orca-Session.ps1" -Setup %*
set CODE=%errorlevel%
echo.
if %CODE% neq 0 (
  echo [RESULT] Setup finished with code %CODE%. See orca\orca-session.log. Pairing may need the manual steps printed above.
  pause
  exit /b %CODE%
)
echo [RESULT] Setup complete, code 0. Tailscale and Orca are connected to the desktop.
echo %cmdcmdline% | find /I "/c" >nul && pause
exit /b 0
