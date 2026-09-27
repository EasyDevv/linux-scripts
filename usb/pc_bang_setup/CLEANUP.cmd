@echo off
rem pc_bang_setup root launcher: removes whichever of Orca / Moonlight /
rem Tailscale is present, no residue. Microsoft Edge ships with Windows and is
rem never installed or removed by this kit.
rem Delegates to orca\Orca-Session.ps1. Uses Windows PowerShell 5.1 explicitly.
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Administrator rights required.
  echo         Right-click CLEANUP.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0orca\Orca-Session.ps1" -Cleanup %*
set CODE=%errorlevel%
echo.
if %CODE% neq 0 (
  echo [RESULT] Cleanup finished with problems, code %CODE%. See orca\orca-session.log.
  pause
  exit /b %CODE%
)
echo [RESULT] Cleanup clean, code 0. If Orca was used, remember to revoke the grant on the desktop (Orca Settings - Remote Orca Servers - Shared Server Access).
echo %cmdcmdline% | find /I "/c" >nul && pause
exit /b 0
