#Requires -Version 5.1
# Turn off the Tailscale exit-node now. A one-shot task restores it after 1 hour.
$ErrorActionPreference = 'Stop'
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$Apply = 'C:\Users\Docker\Scripts\apply-exit-node.ps1'
$TaskName = 'RestoreExitNode'
$Log = 'C:\Users\Docker\Scripts\exit-node.log'

function Write-Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format o), $msg
    try { Add-Content -LiteralPath $Log -Value $line -Encoding utf8 } catch {}
    Write-Host $line
}

if (-not (Test-Path -LiteralPath $Tailscale)) {
    $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($cmd) { $Tailscale = $cmd.Source }
}
if (-not (Test-Path -LiteralPath $Apply)) {
    throw "missing $Apply"
}

& $Tailscale set --exit-node= | Out-Null
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$when = (Get-Date).AddHours(1)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Apply`""
$trigger = New-ScheduledTaskTrigger -Once -At $when
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Log ("exit-node off until {0:o}; task {1}" -f $when, $TaskName)
Write-Host ''
Write-Host ('Exit-node is OFF. It will turn back on at {0}' -f $when.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Host 'This window closes in 8 seconds.'
Start-Sleep -Seconds 8
