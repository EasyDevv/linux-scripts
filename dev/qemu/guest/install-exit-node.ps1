#Requires -RunAsAdministrator
# Persist the configured exit-node across boot/logon. Do not put the 1-hour
# helper on the desktop; that is request-only. Scripts arrive over SSH.
$ErrorActionPreference = 'Stop'
$Scripts = 'C:\Users\Docker\Scripts'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'

New-Item -ItemType Directory -Path $Scripts -Force | Out-Null

$needed = @(
    'apply-exit-node.ps1'
    'exit-node.txt'
    'disable-exit-node-1h.ps1'
    'tailscale-exit-node-off.bat'
)
foreach ($name in $needed) {
    $path = Join-Path $Scripts $name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "$name missing from $Scripts; push it over SSH from the skill"
    }
}

foreach ($root in @($Desktop, $Scripts)) {
    foreach ($stale in @(
            'exit-node-off-1h.bat'
            'disable-exit-node-1h.bat'
        )) {
        $path = Join-Path $root $stale
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}
foreach ($stale in @(
        'disable-exit-node-1h.ps1'
        'tailscale-exit-node-off.bat'
    )) {
    $path = Join-Path $Desktop $stale
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
    }
}

$apply = Join-Path $Scripts 'apply-exit-node.ps1'
$tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$apply`""
schtasks /Create /TN ApplyExitNodeOnStart /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR $tr | Out-Null
schtasks /Create /TN ApplyExitNodeOnLogon /SC ONLOGON /RU Docker /RL HIGHEST /F /TR $tr | Out-Null

$fix = Join-Path $Startup 'fix-hostlan.cmd'
if (Test-Path -LiteralPath $fix) {
    $text = Get-Content -LiteralPath $fix -Raw
    $text = $text -replace '--exit-node=\s*', ''
    if ($text -notmatch 'apply-exit-node\.ps1') {
        $text = $text.TrimEnd() + "`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$apply`"`r`n"
    }
    Set-Content -LiteralPath $fix -Value $text -Encoding ascii
}

& $apply
Write-Host 'exit-node boot hook installed; desktop helper not copied'
