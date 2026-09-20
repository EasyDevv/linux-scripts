@echo off
rem USB offline Tailscale installer launcher.
rem Uses Windows PowerShell 5.1 explicitly (works on Win10/11/Server 2016+,
rem even when PowerShell 7 is installed). Forwards all args to the .ps1.
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Administrator rights required.
  echo         Right-click INSTALL.cmd and choose "Run as administrator".
  pause
  exit /b 3
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Tailscale.ps1" %*
set CODE=%errorlevel%
echo.
if %CODE% neq 0 (
  echo [RESULT] Install FAILED with code %CODE%. See tailscale-install.log.
  pause
  exit /b %CODE%
)
echo [RESULT] Install finished with code 0.
echo %cmdcmdline% | find /I "/c" >nul && pause
exit /b 0
