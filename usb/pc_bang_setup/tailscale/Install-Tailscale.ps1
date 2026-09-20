#Requires -Version 3.0
<#
.SYNOPSIS
    Offline Tailscale installer for Windows (USB, no download).
    Windows PowerShell 5.1 compatible. Do NOT use PowerShell 7-only syntax.
    Targets the current install layout: C:\Program Files\Tailscale.

.DESCRIPTION
    Installs the Tailscale MSI located next to this script (fully offline),
    then optionally runs "tailscale up" with an auth key.
    Run INSTALL.cmd, or:
        powershell -NoProfile -ExecutionPolicy Bypass -File Install-Tailscale.ps1 [-AuthKey <key>] [-Hostname <name>] [-ExtraArgs ...] [-NoUp]

.PARAMETER AuthKey
    Tailscale auth key. Priority: param > .env.txt (TAILSCALE_AUTH_KEY) >
    TAILSCALE_AUTHKEY environment variable.
    If still empty, the app is installed but "tailscale up" is skipped.

.PARAMETER Hostname
    Node hostname. Defaults to $env:COMPUTERNAME.

.PARAMETER LoginServer
    Optional --login-server URL (Headscale etc.).

.PARAMETER ExtraArgs
    Remaining arguments are appended to "tailscale up" as-is.
    Example: -ExtraArgs --accept-routes --advertise-tags=tag:server

.PARAMETER NoUp
    Install the app only, skip "tailscale up" even if a key is present.

.PARAMETER MsiFile
    Explicit MSI path. Defaults to tailscale-setup-*-<arch>.msi next to script.

.EXIT CODES
    0 = success, 1 = generic error, 2 = MSI not found, 3 = not admin,
    4 = msiexec failed, 5 = "tailscale up" failed.
#>
[CmdletBinding()]
param(
    [string]$AuthKey = "",
    [string]$Hostname = "",
    [string]$LoginServer = "",
    [switch]$NoUp,
    [string]$MsiFile = "",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile   = Join-Path $ScriptDir "tailscale-install.log"
$TailscaleExe = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"

try { Start-Transcript -Path $LogFile -Append -ErrorAction SilentlyContinue } catch { }

function Write-Info([string]$Msg) { Write-Host "[INFO] $Msg" }
function Write-Warn([string]$Msg) { Write-Warning "$Msg" }
function Fail([string]$Msg, [int]$Code) {
    Write-Host "[ERROR] $Msg" -ForegroundColor Red
    Finish $Code
}
# Single exit path: stop logging, then exit. All endings go through here.
function Finish([int]$Code) {
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch { }
    exit $Code
}
# Reads one KEY from .env.txt found by walking up from the script folder
# to the drive root. Never logs the value (secret). Returns "" if absent.
function Read-DotEnvValue([string]$Key) {
    $Dir = $ScriptDir
    while (-not [string]::IsNullOrWhiteSpace($Dir)) {
        $F = Join-Path $Dir ".env.txt"
        if (Test-Path $F) {
            foreach ($L in (Get-Content -Path $F -ErrorAction SilentlyContinue)) {
                $T = $L.Trim()
                if (($T -eq "") -or ($T.StartsWith("#"))) { continue }
                $Eq = $T.IndexOf("=")
                if ($Eq -le 0) { continue }
                if ($T.Substring(0, $Eq).Trim() -ne $Key) { continue }
                $V = $T.Substring($Eq + 1).Trim()
                if ($V.Length -ge 2) {
                    $First = $V.Substring(0, 1)
                    $Last = $V.Substring($V.Length - 1, 1)
                    if ((($First -eq '"') -and ($Last -eq '"')) -or (($First -eq "'") -and ($Last -eq "'"))) {
                        $V = $V.Substring(1, $V.Length - 2)
                    }
                }
                return $V
            }
            return ""
        }
        $Parent = Split-Path -Parent $Dir
        if ([string]::IsNullOrWhiteSpace($Parent) -or ($Parent -eq $Dir)) { break }
        $Dir = $Parent
    }
    return ""
}

# --- 1. Must run as administrator -------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Fail "Administrator rights required. Right-click INSTALL.cmd and choose 'Run as administrator'." 3
}

# --- 2. Resolve MSI (offline, next to this script) ---------------------------
if ([string]::IsNullOrWhiteSpace($MsiFile)) {
    $Arch = $env:PROCESSOR_ARCHITECTURE
    if ([string]::IsNullOrWhiteSpace($Arch)) { $Arch = "AMD64" }
    $Found = Get-ChildItem -Path $ScriptDir -Filter ("tailscale-setup-*-" + $Arch.ToUpperInvariant() + ".msi") -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending | Select-Object -First 1
    if ($Found -eq $null) {
        $Found = Get-ChildItem -Path $ScriptDir -Filter "tailscale-setup-*.msi" -ErrorAction SilentlyContinue |
                 Sort-Object Name -Descending | Select-Object -First 1
    }
    if ($Found -eq $null) { Fail "No tailscale-setup-*.msi found in $ScriptDir. Re-copy the USB files." 2 }
    $MsiFile = $Found.FullName
}
if (-not (Test-Path $MsiFile)) { Fail "MSI not found: $MsiFile" 2 }
Write-Info "MSI: $MsiFile"

# --- 3. Install MSI unless already installed ---------------------------------
$Svc = Get-Service -Name "tailscale" -ErrorAction SilentlyContinue
if (((Test-Path $TailscaleExe)) -and ($Svc -ne $null)) {
    Write-Info "Tailscale already installed ($TailscaleExe). Skipping msiexec."
} else {
    $MsiLog = Join-Path $ScriptDir "tailscale-msiexec.log"
    Write-Info "Installing (silent, no restart)..."
    $MsiArgs = '/i "{0}" /qn /norestart /L*v "{1}" ALLUSERS=1' -f $MsiFile, $MsiLog
    $Proc = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList $MsiArgs -Wait -PassThru
    $Code = $Proc.ExitCode
    if (($Code -ne 0) -and ($Code -ne 1641) -and ($Code -ne 3010)) {
        Fail ("msiexec failed with exit code {0}. See {1}" -f $Code, $MsiLog) 4
    }
    if (($Code -eq 1641) -or ($Code -eq 3010)) {
        Write-Warn "Installer requests a reboot (code $Code). Reboot soon."
    }
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Path $TailscaleExe) { break }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path $TailscaleExe)) { Fail "Install finished but tailscale.exe was not found." 4 }
    Write-Info "Installed: $TailscaleExe"
}

# --- 4. Resolve auth key ------------------------------------------------------
# Priority: -AuthKey param > .env.txt (TAILSCALE_AUTH_KEY) > env var.
if ([string]::IsNullOrWhiteSpace($AuthKey)) {
    $AuthKey = Read-DotEnvValue "TAILSCALE_AUTH_KEY"
    if (-not [string]::IsNullOrWhiteSpace($AuthKey)) { Write-Info "Auth key loaded from .env.txt." }
}
if ([string]::IsNullOrWhiteSpace($AuthKey)) {
    if (-not [string]::IsNullOrWhiteSpace($env:TAILSCALE_AUTHKEY)) {
        $AuthKey = $env:TAILSCALE_AUTHKEY
        Write-Info "Auth key loaded from TAILSCALE_AUTHKEY."
    }
}

if ([string]::IsNullOrWhiteSpace($Hostname)) { $Hostname = $env:COMPUTERNAME }
$Hostname = $Hostname.Trim().ToLowerInvariant()

if ($NoUp) {
    Write-Info "NoUp specified. App installed; run 'tailscale up' or 'tailscale login' manually."
    Finish 0
}
if ([string]::IsNullOrWhiteSpace($AuthKey)) {
    Write-Warn "No auth key found (param / .env.txt / TAILSCALE_AUTHKEY). App installed; log in manually via the Tailscale tray icon or 'tailscale login'."
    Finish 0
}

# --- 5. tailscale up ----------------------------------------------------------
$UpArgs = @("up", "--unattended", ("--authkey=" + $AuthKey), ("--hostname=" + $Hostname))
if (-not [string]::IsNullOrWhiteSpace($LoginServer)) { $UpArgs += ("--login-server=" + $LoginServer.Trim()) }
foreach ($A in $ExtraArgs) { $UpArgs += $A }

Write-Info "Running: tailscale up --unattended --hostname=$Hostname ..."
$Attempt = 0
$UpOk = $false
while (($Attempt -lt 2) -and (-not $UpOk)) {
    $Attempt++
    # Native stderr under Stop preference throws; Continue keeps it capturable.
    $OldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $Out = & $TailscaleExe $UpArgs 2>&1 | Out-String
    $UpCode = $LASTEXITCODE
    $ErrorActionPreference = $OldEAP
    Write-Host $Out
    if ($UpCode -eq 0) { $UpOk = $true }
    elseif ($Attempt -lt 2) { Write-Warn "tailscale up failed (attempt $Attempt). Retrying in 10s..."; Start-Sleep -Seconds 10 }
}
if (-not $UpOk) { Fail "'tailscale up' failed. Check the key (expired/reused?) and network, then re-run INSTALL.cmd." 5 }

# --- 6. Verify ----------------------------------------------------------------
Write-Info "Status:"
$OldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $TailscaleExe status 2>&1 | Out-String | Write-Host
$ErrorActionPreference = $OldEAP
$SvcNow = Get-Service -Name "tailscale" -ErrorAction SilentlyContinue
if ($SvcNow -ne $null) { Write-Info ("Service tailscale: " + $SvcNow.Status) }

Write-Info "Done."
Finish 0
