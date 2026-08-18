@echo off
:: Elevate and run the reusable OpenSSH setup script from the shared folder.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ssh.ps1"
if errorlevel 1 (
  echo Setup failed.
  exit /b 1
)
echo SSH setup finished.
