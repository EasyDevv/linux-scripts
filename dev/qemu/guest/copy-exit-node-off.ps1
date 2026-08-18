#Requires -Version 5.1
# Copy the 1-hour exit-node-off helper to the current user's desktop.
$ErrorActionPreference = 'Stop'
$Scripts = 'C:\Users\Docker\Scripts'
$Desktop = 'C:\Users\Docker\Desktop'
$Name = 'tailscale-exit-node-off.bat'
$src = Join-Path $Scripts $Name
if (-not (Test-Path -LiteralPath $src)) {
    throw "missing $src; install the boot hook first"
}
$dest = Join-Path $Desktop $Name
Copy-Item -LiteralPath $src -Destination $dest -Force
Write-Host "copied $dest"
