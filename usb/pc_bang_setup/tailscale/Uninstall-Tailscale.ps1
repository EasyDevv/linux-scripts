#Requires -Version 3.0
<#
.SYNOPSIS
    Fully uninstall Tailscale on Windows, leaving no user-data residue.
    Windows PowerShell 5.1 compatible. Do NOT use PowerShell 7-only syntax.
    Targets the current install layout: C:\Program Files\Tailscale.

.DESCRIPTION
    1. tailscale logout (best effort)
    2. Stop the tailscale service
    3. msiexec /x (ProductCode from registry, or local MSI next to script)
    4. Remove the "Tailscale Tunnel" (wintun) adapter if left behind
    5. Delete data dirs for ALL users + systemprofile + ProgramData
    6. Delete the Tailscale registry key and firewall rules
    7. Verify and report anything left over
    Run UNINSTALL.cmd, or:
        powershell -NoProfile -ExecutionPolicy Bypass -File Uninstall-Tailscale.ps1 [-KeepData]

.PARAMETER KeepData
    Skip data-directory / registry deletion (app removal only).

.EXIT CODES
    0 = clean (nothing left), 1 = errors or remnants remain (see log).
#>
[CmdletBinding()]
param(
    [switch]$KeepData
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile   = Join-Path $ScriptDir "tailscale-uninstall.log"
$TailscaleExe = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
$TailscaleDir = Join-Path $env:ProgramFiles "Tailscale"
$TailscaleData = Join-Path $env:ProgramData "Tailscale"
$UninstallRoot = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"

try { Start-Transcript -Path $LogFile -Append -ErrorAction SilentlyContinue } catch { }

$Failures = @()

function Write-Info([string]$Msg) { Write-Host "[INFO] $Msg" }
function Write-Warn([string]$Msg) { Write-Warning "$Msg" }
# Single exit path: stop logging, then exit. All endings go through here.
function Finish([int]$Code) {
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch { }
    exit $Code
}
function Remove-PathSafe([string]$P) {
    if ([string]::IsNullOrWhiteSpace($P)) { return }
    if (Test-Path $P) {
        try {
            Remove-Item -Path $P -Recurse -Force -ErrorAction Stop
            Write-Info "Removed: $P"
        } catch {
            $Msg = "Could not remove: $P ($($_.Exception.Message))"
            Write-Warn $Msg
            $script:Failures += $Msg
        }
    }
}

# NOTE: $_.PSObject.Properties[...] guard is required. Under Set-StrictMode,
# reading .DisplayName on a key without that value throws and aborts the scan.
function Get-TailscaleKeys {
    Get-ItemProperty -Path $UninstallRoot -ErrorAction SilentlyContinue |
        Where-Object { ($_.PSObject.Properties["DisplayName"] -ne $null) -and ($_.DisplayName -like "*Tailscale*") }
}

# --- 1. Must run as administrator -------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Host "[ERROR] Administrator rights required. Right-click UNINSTALL.cmd and choose 'Run as administrator'." -ForegroundColor Red
    Finish 1
}

# --- 2. Logout + stop service (best effort) -----------------------------------
if (Test-Path $TailscaleExe) {
    Write-Info "Logging out..."
    try { & $TailscaleExe logout 2>&1 | Out-String | Write-Host } catch { Write-Warn "logout failed (ignored): $($_.Exception.Message)" }
} else {
    Write-Info "tailscale.exe not found; skipping logout."
}

$Svc = Get-Service -Name "tailscale" -ErrorAction SilentlyContinue
if ($Svc -ne $null) {
    Write-Info "Stopping service 'tailscale'..."
    try {
        Stop-Service -Name "tailscale" -Force -ErrorAction Stop
        $Svc.WaitForStatus("Stopped", "00:00:30")
        Write-Info "Service stopped."
    } catch { Write-Warn "Could not stop service (continuing): $($_.Exception.Message)" }
} else {
    Write-Info "Service 'tailscale' not present."
}

# --- 3. msiexec /x ------------------------------------------------------------
$ProductCode = $null
foreach ($K in (Get-TailscaleKeys)) {
    if ($K.PSChildName -match "^\{[0-9A-Fa-f-]{36}\}$") { $ProductCode = $K.PSChildName }
}

$MsiLog = Join-Path $ScriptDir "tailscale-msiexec-uninstall.log"
if ($ProductCode -ne $null) {
    Write-Info "Uninstalling via ProductCode $ProductCode ..."
    $Proc = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList ('/x {0} /qn /norestart /L*v "{1}"' -f $ProductCode, $MsiLog) -Wait -PassThru
} else {
    Write-Info "No Tailscale ProductCode in registry; trying local MSI..."
    $LocalMsi = Get-ChildItem -Path $ScriptDir -Filter "tailscale-setup-*.msi" -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending | Select-Object -First 1
    if ($LocalMsi -eq $null) {
        $Msg = "No local MSI either; continuing with manual cleanup only."
        Write-Warn $Msg
        $Failures += $Msg
        $Proc = $null
    } else {
        $Proc = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList ('/x "{0}" /qn /norestart /L*v "{1}"' -f $LocalMsi.FullName, $MsiLog) -Wait -PassThru
    }
}
if ($Proc -ne $null) {
    if (($Proc.ExitCode -eq 0) -or ($Proc.ExitCode -eq 1605) -or ($Proc.ExitCode -eq 1641) -or ($Proc.ExitCode -eq 3010)) {
        Write-Info "msiexec /x finished (code $($Proc.ExitCode))."
    } else {
        $Msg = "msiexec /x failed with code $($Proc.ExitCode). See $MsiLog"
        Write-Warn $Msg
        $Failures += $Msg
    }
}

# Wait for the service registration to disappear.
for ($i = 0; $i -lt 30; $i++) {
    if ((Get-Service -Name "tailscale" -ErrorAction SilentlyContinue) -eq $null) { break }
    Start-Sleep -Seconds 2
}

# --- 4. Remove leftover "Tailscale Tunnel" adapter (best effort) ---------------
try {
    $Adapters = Get-NetAdapter -ErrorAction SilentlyContinue |
                Where-Object { ($_.Name -like "Tailscale*") -or ($_.InterfaceDescription -like "*Tailscale*") }
    foreach ($A in $Adapters) {
        Write-Info "Removing leftover adapter: $($A.Name) ..."
        try { Disable-NetAdapter -Name $A.Name -Confirm:$false -ErrorAction SilentlyContinue } catch { }
        try { Remove-NetAdapter -Name $A.Name -Confirm:$false -ErrorAction Stop; Write-Info "Adapter removed." } catch {
            $Msg = "Could not remove adapter $($A.Name) (check Device Manager > Network adapters): $($_.Exception.Message)"
            Write-Warn $Msg
            $Failures += $Msg
        }
    }
} catch { Write-Warn "Adapter scan failed (ignored): $($_.Exception.Message)" }

# --- 5/6. Data dirs, registry, firewall ----------------------------------------
if ($KeepData) {
    Write-Info "KeepData specified; skipping data/registry deletion."
} else {
    Write-Info "Deleting data directories..."
    Remove-PathSafe $TailscaleData
    Remove-PathSafe $TailscaleDir
    Remove-PathSafe "C:\Windows\System32\config\systemprofile\AppData\Local\Tailscale"
    $Profiles = Get-ChildItem -Path "C:\Users" -Directory -ErrorAction SilentlyContinue
    foreach ($Pr in $Profiles) {
        Remove-PathSafe (Join-Path $Pr.FullName "AppData\Local\Tailscale")
    }

    Write-Info "Deleting registry keys..."
    if (Test-Path "HKLM:\SOFTWARE\Tailscale") {
        try { Remove-Item -Path "HKLM:\SOFTWARE\Tailscale" -Recurse -Force -ErrorAction Stop; Write-Info "Removed registry: HKLM:\SOFTWARE\Tailscale" } catch {
            $Msg = "Could not remove registry: HKLM:\SOFTWARE\Tailscale ($($_.Exception.Message))"
            Write-Warn $Msg
            $Failures += $Msg
        }
    }
    foreach ($K in (Get-TailscaleKeys)) {
        $Full = $UninstallRoot.TrimEnd("*") + $K.PSChildName
        if (Test-Path $Full) {
            try { Remove-Item -Path $Full -Recurse -Force -ErrorAction Stop; Write-Info "Removed registry: $Full" } catch {
                $Msg = "Could not remove registry: $Full ($($_.Exception.Message))"
                Write-Warn $Msg
                $Failures += $Msg
            }
        }
    }

    Write-Info "Deleting firewall rules..."
    try {
        $Rules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { ($_.DisplayName -like "*Tailscale*") -or ($_.Name -like "*Tailscale*") }
        foreach ($R in $Rules) {
            try { Remove-NetFirewallRule -Name $R.Name -ErrorAction Stop; Write-Info "Removed firewall rule: $($R.DisplayName)" } catch {
                Write-Warn "Could not remove firewall rule $($R.DisplayName) (ignored)."
            }
        }
    } catch { Write-Warn "Firewall scan failed (ignored): $($_.Exception.Message)" }
}

# --- 7. Verify -----------------------------------------------------------------
Write-Info "Verifying..."
$Remnants = @()
if ((Get-Service -Name "tailscale" -ErrorAction SilentlyContinue) -ne $null) { $Remnants += "service 'tailscale' still registered" }
foreach ($C in @($TailscaleExe, $TailscaleDir, $TailscaleData)) {
    if (Test-Path $C) { $Remnants += "still exists: $C" }
}
if (-not $KeepData) {
    if (Test-Path "HKLM:\SOFTWARE\Tailscale") { $Remnants += "registry key still exists: HKLM:\SOFTWARE\Tailscale" }
    foreach ($K in (Get-TailscaleKeys)) { $Remnants += ("ARP entry still exists: " + $K.PSChildName) }
}
foreach ($R in $Remnants) { Write-Warn $R; $Failures += $R }

if ($Failures.Count -eq 0) {
    Write-Info "Uninstall complete. No residue found."
    Finish 0
} else {
    Write-Host ("[ERROR] Finished with {0} problem(s). See {1}" -f $Failures.Count, $LogFile) -ForegroundColor Red
    Finish 1
}
