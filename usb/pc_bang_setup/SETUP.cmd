@echo off
rem pc_bang_setup root launcher: installs Tailscale (fixed) plus the selected
rem client(s) (Moonlight and/or Orca), opens the Sunshine registration page in
rem the built-in Microsoft Edge (no browser install), and launches Moonlight so
rem its PIN can be entered on that page. Delegates to orca\Orca-Session.ps1.
rem Uses Windows PowerShell 5.1 explicitly. Forwards all args.
rem   No client flags  -> multi-select menu (Space toggle, Enter confirm,
rem                         Moonlight pre-selected).
rem   SETUP.cmd -WithMoonlight        Moonlight only
rem   SETUP.cmd -WithOrca             Orca only
rem   SETUP.cmd -NonInteractive       both, no questions (ssh/test)
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
if %CODE% equ 7 (
  echo [RESULT] Installed, but Orca pairing is incomplete - code 7. Moonlight/Sunshine may already work.
  echo          See orca\orca-session.log and follow the manual pairing steps printed above.
  pause
  exit /b %CODE%
)
if %CODE% neq 0 (
  echo [RESULT] Setup finished with code %CODE%. See orca\orca-session.log.
  pause
  exit /b %CODE%
)
echo [RESULT] Setup complete, code 0. Sunshine page opened in Microsoft Edge; Moonlight/Orca ready.
echo %cmdcmdline% | find /I "/c" >nul && pause
exit /b 0
