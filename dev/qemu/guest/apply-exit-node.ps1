#Requires -Version 5.1
# Apply the default Tailscale exit-node. Safe to run at boot, logon, or by hand.
$ErrorActionPreference = 'Continue'
$ExitNode = 'redmi-note-3'
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$Log = 'C:\Users\Docker\Scripts\exit-node.log'

function Write-Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format o), $msg
    try {
        $dir = Split-Path -Parent $Log
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Add-Content -LiteralPath $Log -Value $line -Encoding utf8
    } catch {}
    Write-Host $line
}

if (-not (Test-Path -LiteralPath $Tailscale)) {
    $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($cmd) { $Tailscale = $cmd.Source }
}

if (-not (Test-Path -LiteralPath $Tailscale)) {
    Write-Log 'tailscale.exe not found'
    exit 1
}

for ($i = 1; $i -le 36; $i++) {
    $svc = Get-Service Tailscale -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
        try { Start-Service Tailscale } catch {}
    }
    $set = & $Tailscale set --exit-node=$ExitNode --exit-node-allow-lan-access=true 2>&1
    $prefsRaw = & $Tailscale debug prefs 2>$null
    $id = ''
    try {
        $prefs = $prefsRaw | ConvertFrom-Json
        $id = [string]$prefs.ExitNodeID
    } catch {}
    if ($id) {
        Write-Log ("applied {0} ExitNodeID={1} attempt={2}" -f $ExitNode, $id, $i)
        exit 0
    }
    Write-Log ("waiting for tailscale exit-node attempt={0} out={1}" -f $i, ($set | Out-String).Trim())
    Start-Sleep -Seconds 5
}

Write-Log 'failed to apply exit-node'
exit 1
