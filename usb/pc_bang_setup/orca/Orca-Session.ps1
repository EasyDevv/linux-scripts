#Requires -Version 3.0
<#
.SYNOPSIS
    Integrated Orca PC-bang session script: Tailscale + Orca install,
    connect to the desktop, and full cleanup afterwards.
    Windows PowerShell 5.1 compatible. Do NOT use PowerShell 7-only syntax.

.DESCRIPTION
    -Setup:   ensure Tailscale (via ..\tailscale) installed+up, install Orca
              silently, launch it, and pair it to the desktop with
              "orca environment add" using the pre-generated access link.
    -Cleanup: uninstall Orca (no residue), delete the pasted access link,
              then uninstall Tailscale (via ..\tailscale).
    Run ..\SETUP.cmd / ..\CLEANUP.cmd (pc_bang_setup root), or:
        powershell -NoProfile -ExecutionPolicy Bypass -File Orca-Session.ps1 -Setup [-ServerLink <link>] [-AuthKey <key>]
        powershell -NoProfile -ExecutionPolicy Bypass -File Orca-Session.ps1 -Cleanup

    The access link must be generated ON THE DESKTOP beforehand:
    Orca > Settings > Remote Orca Servers > New Link >
    select Tailscale address > Generate Access Link.
    Save it as ORCA_CLIENT_URL in pc_bang_setup/.env.txt (see .env.example).

.EXIT CODES
    0 = Setup connected / Cleanup clean.
    1 = Cleanup problems or remnants remain (see log).
    2 = installer file not found. 3 = not admin.
    4 = Tailscale setup failed. 6 = Orca install failed.
    7 = installed but NOT connected/paired (see message + manual steps).
#>
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Cleanup,
    [string]$ServerLink = "",
    [string]$AuthKey = "",
    [string]$Hostname = "",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile      = Join-Path $ScriptDir "orca-session.log"
$TailscaleDir = Join-Path (Split-Path -Parent $ScriptDir) "tailscale"
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
function Copy-LinkToClipboard([string]$Link) {
    try { Set-Clipboard -Value $Link -ErrorAction SilentlyContinue; Write-Info "Access link copied to clipboard." } catch { }
}
# Single removal path for files, dirs, and registry keys. Records failures
# into script-scope $Failures so the final verify can report them.
function Remove-Tree([string]$P) {
    if ([string]::IsNullOrWhiteSpace($P)) { return }
    if (-not (Test-Path $P)) { return }
    try {
        Remove-Item -Path $P -Recurse -Force -ErrorAction Stop
        Write-Info "Removed: $P"
    } catch {
        $Msg = "Could not remove: $P ($($_.Exception.Message))"
        Write-Warn $Msg
        $script:Failures += $Msg
    }
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
function Read-RemoteServerInfo {
    $Info = @{ hostname = ""; dns = ""; ip = ""; orca_version = "" }
    $F = Join-Path (Split-Path -Parent $ScriptDir) "remote-server.txt"
    if (Test-Path $F) {
        foreach ($L in (Get-Content -Path $F -ErrorAction SilentlyContinue)) {
            $T = $L.Trim()
            if (($T -eq "") -or ($T.StartsWith("#"))) { continue }
            $Eq = $T.IndexOf("=")
            if ($Eq -gt 0) { $Info[$T.Substring(0, $Eq).Trim()] = $T.Substring($Eq + 1).Trim() }
        }
    }
    return $Info
}
# NOTE: $_.PSObject.Properties[...] guard is required. Under Set-StrictMode,
# reading .DisplayName on a key without that value throws and aborts the scan.
function Get-ArpKeys([string]$Like) {
    # Orca's per-user NSIS installer registers under HKCU, MSI (Tailscale) under HKLM.
    foreach ($Root in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
                         "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*")) {
        Get-ItemProperty -Path $Root -ErrorAction SilentlyContinue |
            Where-Object { ($_.PSObject.Properties["DisplayName"] -ne $null) -and ($_.DisplayName -like $Like) }
    }
}
function Get-OrcaExe {
    foreach ($K in (Get-ArpKeys "*Orca*")) {
        $U = $K.UninstallString
        if (-not [string]::IsNullOrWhiteSpace($U)) {
            $U = $U.Trim().Trim('"')
            $Cut = $U.IndexOf(".exe", [StringComparison]::OrdinalIgnoreCase)
            if ($Cut -gt 0) {
                $Dir = Split-Path -Parent $U.Substring(0, $Cut + 4)
                $Cand = Join-Path $Dir "Orca.exe"
                if (Test-Path $Cand) { return $Cand }
            }
        }
    }
    foreach ($C in @((Join-Path ${env:LocalAppData} "Programs\Orca\Orca.exe"),
                     (Join-Path $env:ProgramFiles "Orca\Orca.exe"))) {
        if (Test-Path $C) { return $C }
    }
    return $null
}
function Get-OrcaCli([string]$OrcaExePath) {
    # NOTE: the filesystem is case-insensitive, so a Test-Path for orca.exe
    # also matches the GUI Orca.exe, which cannot serve CLI commands
    # headlessly. Reject any candidate that is the same file as the GUI.
    $GuiFull = ""
    try { if ((Test-Path $OrcaExePath)) { $GuiFull = (Get-Item $OrcaExePath -ErrorAction Stop).FullName } } catch { }
    if ($GuiFull -ne "") {
        $Cand = Join-Path (Split-Path -Parent $GuiFull) "orca.exe"
        if (Test-Path $Cand) {
            try {
                if ((Get-Item $Cand -ErrorAction Stop).FullName -ne $GuiFull) { return $Cand }
            } catch { }
        }
    }
    try {
        $Cmd = Get-Command "orca.exe" -ErrorAction SilentlyContinue
        if (($Cmd -ne $null) -and ($Cmd.Source -ne $GuiFull)) { return $Cmd.Source }
    } catch { }
    return $null
}

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Fail "Administrator rights required. Right-click the .cmd and choose 'Run as administrator'." 3
}
if ((-not $Setup) -and (-not $Cleanup)) {
    Fail "Specify -Setup or -Cleanup. Use SETUP.cmd / CLEANUP.cmd." 1
}
$Remote = Read-RemoteServerInfo
$EnvName = $Remote["hostname"]
if ([string]::IsNullOrWhiteSpace($EnvName)) { $EnvName = "desktop" }
$Failures = @()

# ============================== SETUP =======================================
if ($Setup) {
    # --- 1. Tailscale (child script in ..\tailscale) -------------------------
    $TsSvc = Get-Service -Name "tailscale" -ErrorAction SilentlyContinue
    if (((Test-Path $TailscaleExe)) -and ($TsSvc -ne $null)) {
        Write-Info "Tailscale already installed. Skipping its installer."
    } else {
        $TsScript = Join-Path $TailscaleDir "Install-Tailscale.ps1"
        if (-not (Test-Path $TsScript)) { Fail "Tailscale installer not found: $TsScript" 4 }
        $TsArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $TsScript)
        if (-not [string]::IsNullOrWhiteSpace($AuthKey)) { $TsArgs += @("-AuthKey", $AuthKey) }
        if (-not [string]::IsNullOrWhiteSpace($Hostname)) { $TsArgs += @("-Hostname", $Hostname) }
        foreach ($A in $ExtraArgs) { $TsArgs += $A }
        Write-Info "Installing Tailscale..."
        $TsProc = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $TsArgs -Wait -PassThru
        if ($TsProc.ExitCode -ne 0) { Fail ("Tailscale setup failed (code {0}). See tailscale logs in ..\tailscale." -f $TsProc.ExitCode) 4 }
    }
    $TsConnected = $false
    if (Test-Path $TailscaleExe) {
        try {
            $St = & $TailscaleExe status 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) { $TsConnected = $true; Write-Info "Tailscale connected." }
        } catch { }
    }
    if (-not $TsConnected) {
        Write-Warn "Tailscale is installed but not connected. The desktop is unreachable until it connects - re-run SETUP with a valid key."
    }

    # --- 2. Orca silent install ----------------------------------------------
    $OrcaSetup = Get-ChildItem -Path $ScriptDir -Filter "orca-windows-setup*.exe" -ErrorAction SilentlyContinue |
                 Sort-Object Name -Descending | Select-Object -First 1
    if ($OrcaSetup -eq $null) { Fail "No orca-windows-setup*.exe found in $ScriptDir. Re-copy the USB files." 2 }
    $OrcaExe = Get-OrcaExe
    if ($OrcaExe -eq $null) {
        Write-Info ("Installing Orca ({0}), silent..." -f $OrcaSetup.Name)
        $OrcaProc = Start-Process -FilePath $OrcaSetup.FullName -ArgumentList "/S" -Wait -PassThru
        if ($OrcaProc.ExitCode -ne 0) { Fail ("Orca installer failed (code {0})." -f $OrcaProc.ExitCode) 6 }
        for ($i = 0; $i -lt 60; $i++) {
            $OrcaExe = Get-OrcaExe
            if ($OrcaExe -ne $null) { break }
            Start-Sleep -Seconds 2
        }
        if ($OrcaExe -eq $null) { Fail "Orca installer finished but Orca.exe was not found." 6 }
        Write-Info "Installed: $OrcaExe"
    } else {
        Write-Info "Orca already installed ($OrcaExe). Skipping installer."
    }

    # --- 3. Launch Orca --------------------------------------------------------
    try { Start-Process -FilePath $OrcaExe -ErrorAction SilentlyContinue; Write-Info "Orca launched." } catch { Write-Warn "Could not launch Orca window (continuing)." }

    # --- 4. Pair with the desktop ---------------------------------------------
    # Source: -ServerLink param, else .env.txt (ORCA_CLIENT_URL).
    if ([string]::IsNullOrWhiteSpace($ServerLink)) { $ServerLink = Read-DotEnvValue "ORCA_CLIENT_URL" }
    $OrcaCli = Get-OrcaCli $OrcaExe
    if ([string]::IsNullOrWhiteSpace($ServerLink)) {
        Write-Host ""
        Write-Host "NEXT STEPS (manual pairing - no access link found):" -ForegroundColor Yellow
        Write-Host ("  Remote server: {0} ({1} / {2})" -f $Remote["hostname"], $Remote["dns"], $Remote["ip"])
        Write-Host "  1. On the DESKTOP: Orca > Settings > Remote Orca Servers > New Link >"
        Write-Host "     select Tailscale address > Generate Access Link > copy it."
        Write-Host "  2. Put it as ORCA_CLIENT_URL in pc_bang_setup/.env.txt and re-run SETUP.cmd,"
        Write-Host "     or paste it at: Orca > Settings > Remote Orca Servers > Add Server."
        Finish 7
    }
    if ([string]::IsNullOrWhiteSpace($OrcaCli)) {
        Write-Warn "Orca CLI (orca.exe) not found next to Orca.exe. Pair manually:"
        Write-Host "  Orca > Settings > Remote Orca Servers > Add Server > paste the link (pc_bang_setup/.env.txt ORCA_CLIENT_URL)" -ForegroundColor Yellow
        Copy-LinkToClipboard $ServerLink
        Finish 7
    }
    Write-Info "Waiting for Orca runtime (up to 3 min)..."
    $RuntimeOk = $false
    for ($i = 0; $i -lt 45; $i++) {
        try {
            $null = & $OrcaCli environment list 2>&1
            if ($LASTEXITCODE -eq 0) { $RuntimeOk = $true; break }
        } catch { }
        Start-Sleep -Seconds 4
    }
    if (-not $RuntimeOk) {
        Write-Warn "Orca runtime did not answer. Pair manually: Settings > Remote Orca Servers > Add Server."
        Copy-LinkToClipboard $ServerLink
        Finish 7
    }
    Write-Info ("Pairing to desktop as '{0}'..." -f $EnvName)
    # Native stderr under Stop preference throws; Continue keeps it capturable.
    $OldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $PairOut = & $OrcaCli environment add --name $EnvName --pairing-code $ServerLink 2>&1 | Out-String
    $PairCode = $LASTEXITCODE
    $ErrorActionPreference = $OldEAP
    Write-Host $PairOut
    $Paired = $false
    if ($PairCode -eq 0) {
        $OldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $ListOut = & $OrcaCli environment list 2>&1 | Out-String
        $ListCode = $LASTEXITCODE
        $ErrorActionPreference = $OldEAP
        if (($ListCode -eq 0) -and ($ListOut -match [regex]::Escape($EnvName))) { $Paired = $true }
    }
    if (-not $Paired) {
        Write-Warn "Auto-pairing failed (link expired or desktop unreachable?). Pair manually:"
        Write-Host "  Orca > Settings > Remote Orca Servers > Add Server > paste the link (pc_bang_setup/.env.txt ORCA_CLIENT_URL)" -ForegroundColor Yellow
        Copy-LinkToClipboard $ServerLink
        Finish 7
    }
    Write-Info ("Connected to '{0}'. Work normally; agents keep running on the desktop." -f $EnvName)
    Finish 0
}

# ============================== CLEANUP =====================================
if ($Cleanup) {
    # --- 1. Stop Orca ----------------------------------------------------------
    try {
        $Procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { ($_.ProcessName -like "Orca*") -or ($_.ProcessName -like "orca*") }
        foreach ($P in $Procs) {
            try { Stop-Process -Id $P.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
        if ($Procs -ne $null) { Write-Info "Orca processes stopped."; Start-Sleep -Seconds 3 }
    } catch { }

    # --- 2. Uninstall Orca ------------------------------------------------------
    $OrcaExeNow = Get-OrcaExe
    $Uninst = $null
    foreach ($K in (Get-ArpKeys "*Orca*")) {
        if (-not [string]::IsNullOrWhiteSpace($K.UninstallString)) { $Uninst = $K.UninstallString.Trim(); break }
    }
    if ($Uninst -ne $null) {
        if ($Uninst -notmatch "(?i)/S(\s|$)") { $Uninst += " /S" }
        Write-Info "Uninstalling Orca..."
        try {
            $Up = Start-Process -FilePath "cmd.exe" -ArgumentList ('/c {0}' -f $Uninst) -Wait -PassThru
            Write-Info ("Orca uninstaller finished (code {0})." -f $Up.ExitCode)
        } catch {
            $Msg = "Orca uninstaller failed: $($_.Exception.Message)"
            Write-Warn $Msg
            $Failures += $Msg
        }
    } elseif ($OrcaExeNow -ne $null) {
        $FallUn = Join-Path (Split-Path -Parent $OrcaExeNow) "Uninstall.exe"
        if (Test-Path $FallUn) {
            Write-Info "Uninstalling Orca (fallback Uninstall.exe)..."
            $Up = Start-Process -FilePath $FallUn -ArgumentList "/S" -Wait -PassThru
            Write-Info ("Orca uninstaller finished (code {0})." -f $Up.ExitCode)
        } else {
            $Msg = "No Orca uninstall entry found; continuing with manual cleanup only."
            Write-Warn $Msg
            $Failures += $Msg
        }
    } else {
        Write-Info "Orca not installed; skipping uninstaller."
    }
    for ($i = 0; $i -lt 30; $i++) {
        if ((Get-OrcaExe) -eq $null) { break }
        Start-Sleep -Seconds 2
    }

    # --- 3. Delete Orca data dirs (all users) ------------------------------------
    Write-Info "Deleting Orca data directories..."
    $DataRoots = @()
    foreach ($Pr in (Get-ChildItem -Path "C:\Users" -Directory -ErrorAction SilentlyContinue)) {
        $DataRoots += (Join-Path $Pr.FullName "AppData\Local")
        $DataRoots += (Join-Path $Pr.FullName "AppData\Roaming")
    }
    foreach ($DR in $DataRoots) {
        if (-not (Test-Path $DR)) { continue }
        foreach ($D in (Get-ChildItem -Path $DR -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "orca*" })) {
            Remove-Tree $D.FullName
        }
    }
    foreach ($D in @((Join-Path $env:ProgramFiles "Orca"), (Join-Path ${env:ProgramFiles(x86)} "Orca"))) {
        Remove-Tree $D
    }
    foreach ($K in (Get-ArpKeys "*Orca*")) {
        foreach ($Hive in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\")) {
            Remove-Tree ($Hive + $K.PSChildName)
        }
    }
    foreach ($RK in @("HKLM:\SOFTWARE\Orca", "HKCU:\SOFTWARE\Orca")) {
        Remove-Tree $RK
    }

    # --- 4. Uninstall Tailscale (child script in ..\tailscale) --------------------
    $TsScript = Join-Path $TailscaleDir "Uninstall-Tailscale.ps1"
    if (Test-Path $TsScript) {
        Write-Info "Uninstalling Tailscale..."
        $TsProc = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $TsScript) -Wait -PassThru
        if ($TsProc.ExitCode -ne 0) {
            $Msg = "Tailscale cleanup reported problems (code $($TsProc.ExitCode)). See tailscale logs in ..\tailscale."
            Write-Warn $Msg
            $Failures += $Msg
        }
    } else {
        $Msg = "Tailscale uninstaller not found: $TsScript"
        Write-Warn $Msg
        $Failures += $Msg
    }

    # --- 5. Verify -----------------------------------------------------------------
    Write-Info "Verifying..."
    $Remnants = @()
    if ((Get-OrcaExe) -ne $null) { $Remnants += "Orca.exe still present" }
    if ((Get-Service -Name "tailscale" -ErrorAction SilentlyContinue) -ne $null) { $Remnants += "service 'tailscale' still registered" }
    if (Test-Path $TailscaleExe) { $Remnants += "still exists: $TailscaleExe" }
    foreach ($R in $Remnants) { Write-Warn $R; $Failures += $R }

    Write-Host ""
    Write-Host "DESKTOP STEP (do this at home): Orca > Settings > Remote Orca Servers >" -ForegroundColor Yellow
    Write-Host "Shared Server Access > revoke this PC grant." -ForegroundColor Yellow

    if ($Failures.Count -eq 0) {
        Write-Info "Cleanup complete. No residue found."
        Finish 0
    } else {
        Write-Host ("[ERROR] Finished with {0} problem(s). See {1}" -f $Failures.Count, $LogFile) -ForegroundColor Red
        Finish 1
    }
}
