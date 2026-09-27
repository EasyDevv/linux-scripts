#Requires -Version 3.0
<#
.SYNOPSIS
    PC-bang session script: Tailscale (fixed) + Moonlight and/or Orca
    (chosen at install time), Sunshine registration page auto-open in the
    built-in Microsoft Edge, and full cleanup afterwards.
    Windows PowerShell 5.1 compatible. Do NOT use PowerShell 7-only syntax.

.DESCRIPTION
    -Setup:   ensure Tailscale (via ..\tailscale) installed+up, open the
              Sunshine registration page (https://<desktop-ip>:47990) in
              Microsoft Edge (ships with Windows - no browser install step),
              install the selected client(s) (Moonlight and/or Orca), apply
              ..\moonlight-settings.txt to Moonlight, pair Orca to the desktop
              when selected, then launch Moonlight so the PIN it shows can be
              entered on the already-open Sunshine page.
    -Cleanup: uninstall whichever of Orca / Moonlight / Tailscale is
              present, delete their data dirs, then verify no residue.
    Run ..\SETUP.cmd / ..\CLEANUP.cmd (pc_bang_setup root), or:
        powershell -NoProfile -ExecutionPolicy Bypass -File Orca-Session.ps1 -Setup [-WithMoonlight] [-WithOrca] [-NonInteractive] [-ServerLink <link>] [-AuthKey <key>]
        powershell -NoProfile -ExecutionPolicy Bypass -File Orca-Session.ps1 -Cleanup

    Client selection: -WithMoonlight / -WithOrca flags win. With neither flag,
    an interactive console gets a multi-select menu (Space toggles,
    Enter confirms, Moonlight pre-selected); redirected or -NonInteractive
    runs default to Moonlight only.

    The Orca access link must be generated ON THE DESKTOP beforehand:
    Orca > Settings > Remote Orca Servers > New Link >
    select Tailscale address > Generate Access Link.
    Save it as ORCA_CLIENT_URL in pc_bang_setup/.env.txt (see .env.example).
    Moonlight needs no key: approve the PC on the Sunshine page instead.

.EXIT CODES
    0 = Setup done / Cleanup clean.
    1 = Cleanup problems or remnants remain (see log).
    2 = installer file not found. 3 = not admin.
    4 = Tailscale setup failed. 6 = Orca install failed.
    7 = installed but Orca NOT paired (see message + manual steps).
    9 = Moonlight install/settings failed.
#>
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Cleanup,
    [switch]$WithMoonlight,
    [switch]$WithOrca,
    [switch]$NonInteractive,
    [string]$ServerLink = "",
    [string]$AuthKey = "",
    [string]$Hostname = "",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir      = Split-Path -Parent $ScriptDir
$LogFile      = Join-Path $ScriptDir "orca-session.log"
$TailscaleDir = Join-Path $RootDir "tailscale"
$MoonlightDir = Join-Path $RootDir "moonlight"
$MoonlightCfg = Join-Path $RootDir "moonlight-settings.txt"
$TailscaleExe = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
$MoonlightReg = "HKCU:\SOFTWARE\Moonlight Game Streaming Project\Moonlight"
$SunshinePort = "47990"
$FallbackDesktopIp = "100.126.89.8"

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
    $F = Join-Path $RootDir "remote-server.txt"
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
            # UninstallString may be a bare command (MsiExec.exe /I{...}) with
            # no directory part; Split-Path then yields "" which Join-Path rejects.
            if ($Cut -gt 0) {
                $Dir = Split-Path -Parent $U.Substring(0, $Cut + 4) -ErrorAction SilentlyContinue
                if ([string]::IsNullOrWhiteSpace($Dir)) { continue }
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
# Resolves a *usable* winget. App execution aliases do not run in
# service/SYSTEM contexts, so a found path is only returned when
# "winget --version" actually succeeds under the current account.
function Test-WingetUsable([string]$Exe) {
    if ([string]::IsNullOrWhiteSpace($Exe)) { return $false }
    if (-not (Test-Path $Exe)) { return $false }
    # NOTE: $ErrorActionPreference is Stop script-wide. Under Stop, native
    # stderr and a failed & invocation both throw, so drop to
    # SilentlyContinue here and judge only by $? / $LASTEXITCODE.
    $OldEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & $Exe --version >$null 2>$null
    $Ok = ($? -and ($LASTEXITCODE -eq 0))
    $ErrorActionPreference = $OldEAP
    return $Ok
}
function Get-Winget {
    try {
        $Cmd = Get-Command "winget.exe" -ErrorAction SilentlyContinue
        if (($Cmd -ne $null) -and (Test-WingetUsable $Cmd.Source)) { return $Cmd.Source }
    } catch { }
    # Service/SYSTEM contexts lack the App execution alias in PATH.
    # Probe every local profile's WindowsApps folder as a fallback.
    try {
        $Hits = Get-Item -Path "C:\Users\*\AppData\Local\Microsoft\WindowsApps\winget.exe" -ErrorAction SilentlyContinue
        foreach ($Hit in $Hits) {
            if (Test-WingetUsable $Hit.FullName) { return $Hit.FullName }
        }
    } catch { }
    return $null
}
function Get-MoonlightExe {
    foreach ($K in (Get-ArpKeys "*Moonlight*")) {
        $U = $K.UninstallString
        if (-not [string]::IsNullOrWhiteSpace($U)) {
            $U = $U.Trim().Trim('"')
            $Cut = $U.IndexOf(".exe", [StringComparison]::OrdinalIgnoreCase)
            # UninstallString may be a bare command (MsiExec.exe /I{...}) with
            # no directory part; Split-Path then yields "" which Join-Path rejects.
            if ($Cut -gt 0) {
                $Dir = Split-Path -Parent $U.Substring(0, $Cut + 4) -ErrorAction SilentlyContinue
                if ([string]::IsNullOrWhiteSpace($Dir)) { continue }
                foreach ($N in @("Moonlight.exe", "moonlight.exe")) {
                    $Cand = Join-Path $Dir $N
                    if (Test-Path $Cand) { return $Cand }
                }
            }
        }
    }
    foreach ($C in @((Join-Path $env:ProgramFiles "Moonlight Game Streaming\Moonlight.exe"),
                     (Join-Path ${env:ProgramFiles(x86)} "Moonlight Game Streaming\Moonlight.exe"))) {
        if (Test-Path $C) { return $C }
    }
    try {
        $Cmd = Get-Command "moonlight.exe" -ErrorAction SilentlyContinue
        if ($Cmd -ne $null) { return $Cmd.Source }
    } catch { }
    return $null
}
# Microsoft Edge ships with Windows 10/11 - SETUP installs no browser, this
# only locates the preinstalled one. Returns $null when it cannot be found.
function Get-EdgeExe {
    $Cands = @((Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
               (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"))
    # Per-user installs (and service sessions whose profile resolves to
    # systemprofile) land under a user AppData dir - detect those too.
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $Cands += (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
    }
    $Cands += "C:\Windows\System32\config\systemprofile\AppData\Local\Microsoft\Edge\Application\msedge.exe"
    foreach ($C in $Cands) {
        if (Test-Path $C) { return $C }
    }
    try {
        $Cmd = Get-Command "msedge.exe" -ErrorAction SilentlyContinue
        if ($Cmd -ne $null) { return $Cmd.Source }
    } catch { }
    return $null
}
# Starts an installer and waits up to $TimeoutSec seconds. On timeout the
# process is killed and $null is returned (caller then verifies the exe).
# Prevents a hung installer from blocking SETUP forever.
function Start-InstallProcess([string]$File, [string[]]$Arguments, [int]$TimeoutSec) {
    $Proc = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if ($Proc.WaitForExit($TimeoutSec * 1000)) { return $Proc.ExitCode }
    Write-Warn ("Installer timed out after {0}s; killing it and checking the result..." -f $TimeoutSec)
    try { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue } catch { }
    return $null
}
function Wait-ForFile([string]$Path, [int]$Tries, [int]$Seconds) {
    for ($i = 0; $i -lt $Tries; $i++) {
        if (Test-Path $Path) { return $true }
        Start-Sleep -Seconds $Seconds
    }
    return (Test-Path $Path)
}
# Applies ..\moonlight-settings.txt to the Moonlight registry settings of the
# user running SETUP (Moonlight reads these on next launch). Fails with code 9.
function Apply-MoonlightSettings {
    $Defaults = @{ width = 3840; height = 2160; fps = 30; bitrate = 40000; windowmode = 1; mouseacceleration = 1; gameopts = 0 }
    $Vals = @{}
    foreach ($K in $Defaults.Keys) { $Vals[$K] = $Defaults[$K] }
    if (Test-Path $MoonlightCfg) {
        foreach ($L in (Get-Content -Path $MoonlightCfg -ErrorAction SilentlyContinue)) {
            $T = $L.Trim()
            if (($T -eq "") -or ($T.StartsWith("#"))) { continue }
            $Eq = $T.IndexOf("=")
            if ($Eq -le 0) { continue }
            $K = $T.Substring(0, $Eq).Trim().ToLowerInvariant()
            $V = $T.Substring($Eq + 1).Trim()
            if (-not $Vals.ContainsKey($K)) { Write-Warn "moonlight-settings.txt: unknown key '$K' (ignored)."; continue }
            if (($K -eq "mouseacceleration") -or ($K -eq "gameopts")) {
                $VL = $V.ToLowerInvariant()
                if (($VL -eq "true") -or ($VL -eq "1") -or ($VL -eq "yes") -or ($VL -eq "on")) { $Vals[$K] = 1 }
                elseif (($VL -eq "false") -or ($VL -eq "0") -or ($VL -eq "no") -or ($VL -eq "off")) { $Vals[$K] = 0 }
                else { Write-Warn "moonlight-settings.txt: bad bool '$K=$V' (ignored)." }
            } else {
                $N = 0
                if ([int]::TryParse($V, [ref]$N)) { $Vals[$K] = $N } else { Write-Warn "moonlight-settings.txt: bad number '$K=$V' (ignored)." }
            }
        }
        Write-Info "Moonlight preset loaded from moonlight-settings.txt."
    } else {
        Write-Warn "moonlight-settings.txt not found; using built-in defaults (4K 30fps borderless)."
    }
    try {
        if (-not (Test-Path $MoonlightReg)) { New-Item -Path $MoonlightReg -Force | Out-Null }
        foreach ($K in $Vals.Keys) {
            New-ItemProperty -Path $MoonlightReg -Name $K -Value ([int]$Vals[$K]) -PropertyType DWord -Force | Out-Null
        }
    } catch {
        Fail ("Could not write Moonlight settings to registry ($($_.Exception.Message)).") 9
    }
    $Back = Get-ItemProperty -Path $MoonlightReg -ErrorAction SilentlyContinue
    foreach ($K in $Vals.Keys) {
        if (($Back -eq $null) -or ($Back.$K -ne $Vals[$K])) {
            Fail ("Moonlight setting '$K' did not stick in the registry.") 9
        }
    }
    Write-Info ("Moonlight preset applied: {0}x{1} {2}fps, windowmode={3}, mouseacceleration={4}, gameopts={5}, bitrate={6}." -f $Vals["width"], $Vals["height"], $Vals["fps"], $Vals["windowmode"], $Vals["mouseacceleration"], $Vals["gameopts"], $Vals["bitrate"])
}
# Installs Moonlight when selected. Offline MoonlightSetup-*.exe in
# ..\moonlight wins; otherwise winget. Fails with code 9.
function Install-Moonlight {
    $MlExe = Get-MoonlightExe
    if ($MlExe -eq $null) {
        $Tried = $false
        $LocalSetup = Get-ChildItem -Path $MoonlightDir -Filter "MoonlightSetup-*.exe" -ErrorAction SilentlyContinue |
                      Sort-Object Name -Descending | Select-Object -First 1
        if ($LocalSetup -ne $null) {
            $Tried = $true
            Write-Info ("Installing Moonlight offline ({0}), silent..." -f $LocalSetup.Name)
            $Code = Start-InstallProcess $LocalSetup.FullName @("/quiet", "/norestart") 600
            if (($Code -ne $null) -and ($Code -ne 0) -and ($Code -ne 1641) -and ($Code -ne 3010)) {
                Write-Warn ("Moonlight offline installer reported code {0}; trying the next method..." -f $Code)
            }
        }
        if ((Get-MoonlightExe) -eq $null) {
            $Winget = Get-Winget
            if (-not [string]::IsNullOrWhiteSpace($Winget)) {
                $Tried = $true
                Write-Info "Installing Moonlight via winget (MoonlightGameStreamingProject.Moonlight, machine scope)..."
                $Code = Start-InstallProcess $Winget @("install", "--id", "MoonlightGameStreamingProject.Moonlight", "--exact", "--scope", "machine", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements") 900
                if (($Code -ne $null) -and ($Code -ne 0)) {
                    Write-Warn ("winget Moonlight install reported code {0}." -f $Code)
                }
            }
        }
        if (-not $Tried) { Fail "No MoonlightSetup-*.exe in ..\moonlight and winget not found. Put the offline installer in ..\moonlight." 9 }
        for ($i = 0; $i -lt 60; $i++) {
            $MlExe = Get-MoonlightExe
            if ($MlExe -ne $null) { break }
            Start-Sleep -Seconds 2
        }
        if ($MlExe -eq $null) { Fail "Moonlight installer finished but Moonlight.exe was not found." 9 }
        Write-Info "Installed: $MlExe"
    } else {
        Write-Info "Moonlight already installed ($MlExe). Skipping installer."
    }
    Apply-MoonlightSettings
    try { Start-Process -FilePath $MlExe -ErrorAction SilentlyContinue; Write-Info "Moonlight launched." } catch { Write-Warn "Could not launch Moonlight window (continuing)." }
    return $MlExe
}
# Prints the Sunshine PIN registration steps (the manual half of the flow:
# Moonlight host add -> PIN shown by Moonlight -> PIN typed into Sunshine).
function Show-SunshineSteps([string]$Ip) {
    Write-Host ""
    Write-Host "SUNSHINE PIN 등록 (브라우저에서):" -ForegroundColor Yellow
    Write-Host "  1. 인증서 경고가 뜨면 고급 > 계속 진행 (자가서명, 정상)."
    Write-Host "  2. Moonlight > 우상단 + > 호스트 추가 > $Ip 를 입력하면 PIN이 뜬다."
    Write-Host "  3. Sunshine > PIN 입력에 그 PIN을 넣으면 접속 구성 완료."
}
# Opens the Sunshine registration page in Microsoft Edge (preinstalled, so there
# is nothing to install). Best effort: never fails setup. The page is opened
# once per run; later calls only reprint the steps.
function Open-SunshinePage([bool]$TailscaleUpAttempted) {
    $Ip = $Remote["ip"]
    if ([string]::IsNullOrWhiteSpace($Ip)) { $Ip = $FallbackDesktopIp }
    $Url = ("https://{0}:{1}" -f $Ip.Trim(), $SunshinePort)
    if ($SunshineOpened) {
        Show-SunshineSteps $Ip
        return
    }
    if ($TailscaleUpAttempted -and (Test-Path $TailscaleExe)) {
        Write-Info "Waiting for Tailscale connection before opening Sunshine..."
        $Connected = $false
        for ($i = 0; $i -lt 60; $i++) {
            try {
                $null = & $TailscaleExe status 2>&1
                if ($LASTEXITCODE -eq 0) { $Connected = $true; break }
            } catch { }
            Start-Sleep -Seconds 2
        }
        if ($Connected) { Write-Info "Tailscale connected." } else { Write-Warn "Tailscale not connected yet; opening Sunshine page anyway." }
    }
    $EdgeExe = Get-EdgeExe
    if ($EdgeExe -eq $null) {
        Write-Warn ("Microsoft Edge not found; open manually: {0}" -f $Url)
        Show-SunshineSteps $Ip
        return
    }
    try {
        Start-Process -FilePath $EdgeExe -ArgumentList $Url -ErrorAction Stop
        $script:SunshineOpened = $true
        Write-Info ("Sunshine registration page opened in Microsoft Edge: {0}" -f $Url)
    } catch {
        Write-Warn ("Could not launch Microsoft Edge (open manually: {0}): {1}" -f $Url, $_.Exception.Message)
        Show-SunshineSteps $Ip
        return
    }
    Show-SunshineSteps $Ip
}
# Resolves which clients to install. Explicit flags win; interactive console
# gets a multi-select checkbox menu (Space toggles, Enter confirms,
# Moonlight pre-selected); redirected / -NonInteractive runs default to
# Moonlight only.
function Select-Clients {
    if ($WithMoonlight.IsPresent -or $WithOrca.IsPresent) {
        return @{ Moonlight = $WithMoonlight.IsPresent; Orca = $WithOrca.IsPresent }
    }
    $Redirected = $true
    try { $Redirected = [Console]::IsInputRedirected -or [Console]::IsOutputRedirected } catch { $Redirected = $true }
    $DefaultMoonlight = $true
    $DefaultOrca = $false
    if ($NonInteractive.IsPresent -or $Redirected) {
        Write-Info "No client flags given; defaulting to Moonlight only."
        return @{ Moonlight = $DefaultMoonlight; Orca = $DefaultOrca }
    }
    $Items = @(
        @{ Name = "Moonlight"; Desc = "Sunshine 원격데스크톱"; Selected = $true },
        @{ Name = "Orca"; Desc = "에이전트 UI"; Selected = $false }
    )
    $Pos = 0
    try {
        Write-Host ""
        Write-Host "설치할 원격 클라이언트를 선택하세요 (Tailscale은 항상 설치, 브라우저는 Windows 내장 Edge 사용):" -ForegroundColor Yellow
        Write-Host "  [위/아래] 이동  [Space] 선택/해제  [Enter] 진행"
        $Top = [Console]::CursorTop
        [Console]::CursorVisible = $false
        $Confirmed = $false
        while (-not $Confirmed) {
            for ($i = 0; $i -lt $Items.Count; $i++) {
                [Console]::SetCursorPosition(0, $Top + $i)
                $Box = " "
                if ($Items[$i]["Selected"]) { $Box = "x" }
                $Cur = " "
                if ($i -eq $Pos) { $Cur = ">" }
                $Line = ("  {0} [{1}] {2} ({3})" -f $Cur, $Box, $Items[$i]["Name"], $Items[$i]["Desc"])
                $Pad = [Console]::BufferWidth - 1 - $Line.Length
                if ($Pad -gt 0) { $Line += (" " * $Pad) }
                Write-Host $Line
            }
            $Key = [Console]::ReadKey($true)
            if ($Key.Key -eq [ConsoleKey]::UpArrow) {
                $Pos = ($Pos + $Items.Count - 1) % $Items.Count
            } elseif ($Key.Key -eq [ConsoleKey]::DownArrow) {
                $Pos = ($Pos + 1) % $Items.Count
            } elseif ($Key.Key -eq [ConsoleKey]::Spacebar) {
                $Items[$Pos]["Selected"] = -not $Items[$Pos]["Selected"]
            } elseif ($Key.Key -eq [ConsoleKey]::Enter) {
                $Confirmed = $true
            }
        }
        [Console]::SetCursorPosition(0, $Top + $Items.Count)
    } catch {
        try { [Console]::CursorVisible = $true } catch { }
        Write-Warn "Interactive menu unavailable; defaulting to Moonlight only."
        return @{ Moonlight = $DefaultMoonlight; Orca = $DefaultOrca }
    }
    try { [Console]::CursorVisible = $true } catch { }
    return @{ Moonlight = [bool]$Items[0]["Selected"]; Orca = [bool]$Items[1]["Selected"] }
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
$SunshineOpened = $false

# ============================== SETUP =======================================
if ($Setup) {
    $Sel = Select-Clients
    $WantMoonlight = $Sel["Moonlight"]
    $WantOrca = $Sel["Orca"]
    Write-Info ("Selection: Moonlight={0} Orca={1} (+ Tailscale fixed; browser = built-in Microsoft Edge)." -f $WantMoonlight, $WantOrca)

    # --- 1. Tailscale (fixed; child script in ..\tailscale) -------------------
    $TailscaleUpAttempted = $false
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
    } else {
        $TailscaleUpAttempted = $true
    }

    # --- 2. Sunshine registration page in Microsoft Edge ------------------------
    # Tailscale is up by now, so the desktop page is reachable. Opening it here
    # lets the cert warning be clicked through while the clients install, and
    # matches the PIN flow: page open -> Moonlight host add -> PIN -> page.
    Open-SunshinePage $TailscaleUpAttempted

    # --- 3. Moonlight (when selected; launched so it shows the PIN) -------------
    if ($WantMoonlight) {
        Install-Moonlight | Out-Null
    } else {
        Write-Info "Moonlight deselected; skipping."
    }

    # --- 4. Orca (when selected): silent install, launch, pair -----------------
    if ($WantOrca) {
        $OrcaSetup = Get-ChildItem -Path $ScriptDir -Filter "orca-windows-setup*.exe" -ErrorAction SilentlyContinue |
                     Sort-Object Name -Descending | Select-Object -First 1
        if ($OrcaSetup -eq $null) { Fail "No orca-windows-setup*.exe found in $ScriptDir. Re-copy the USB files." 2 }
        $OrcaExe = Get-OrcaExe
        if ($OrcaExe -eq $null) {
            Write-Info ("Installing Orca ({0}), silent..." -f $OrcaSetup.Name)
            $OrcaCode = Start-InstallProcess $OrcaSetup.FullName @("/S") 600
            if (($OrcaCode -ne $null) -and ($OrcaCode -ne 0)) { Fail ("Orca installer failed (code {0})." -f $OrcaCode) 6 }
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

        try { Start-Process -FilePath $OrcaExe -ErrorAction SilentlyContinue; Write-Info "Orca launched." } catch { Write-Warn "Could not launch Orca window (continuing)." }

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
            Open-SunshinePage $TailscaleUpAttempted
            Finish 7
        }
        if ([string]::IsNullOrWhiteSpace($OrcaCli)) {
            Write-Warn "Orca CLI (orca.exe) not found next to Orca.exe. Pair manually:"
            Write-Host "  Orca > Settings > Remote Orca Servers > Add Server > paste the link (pc_bang_setup/.env.txt ORCA_CLIENT_URL)" -ForegroundColor Yellow
            Copy-LinkToClipboard $ServerLink
            Open-SunshinePage $TailscaleUpAttempted
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
            Open-SunshinePage $TailscaleUpAttempted
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
            Open-SunshinePage $TailscaleUpAttempted
            Finish 7
        }
        Write-Info ("Connected to '{0}'. Work normally; agents keep running on the desktop." -f $EnvName)
    } else {
        Write-Info "Orca deselected; skipping install/pairing."
    }

    # --- 5. Final PIN reminder (the page is already open; this reprints steps) ---
    Open-SunshinePage $TailscaleUpAttempted
    Write-Info "Setup done."
    Finish 0
}

# ============================== CLEANUP =====================================
if ($Cleanup) {
    # --- 1. Stop clients ---------------------------------------------------------
    try {
        # NOTE: Microsoft Edge is deliberately NOT touched - it ships with
        # Windows, is not ours to remove, and may hold the user's other tabs.
        $Procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { ($_.ProcessName -like "Orca*") -or ($_.ProcessName -like "orca*") -or ($_.ProcessName -like "Moonlight*") -or ($_.ProcessName -like "moonlight*") }
        foreach ($P in $Procs) {
            try { Stop-Process -Id $P.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
        if ($Procs -ne $null) { Write-Info "Client processes stopped."; Start-Sleep -Seconds 3 }
    } catch { }

    # --- 2. Uninstall Orca (when present) -----------------------------------------
    $OrcaExeNow = Get-OrcaExe
    $OrcaArpKeys = @(Get-ArpKeys "*Orca*")
    $OrcaWasPresent = (($OrcaExeNow -ne $null) -or ($OrcaArpKeys.Count -gt 0))
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

    # --- 3. Delete Orca data dirs (all users) --------------------------------------
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
    # Service/ssh sessions resolve profiles to systemprofile - sweep it too.
    $SysProf = "C:\Windows\System32\config\systemprofile\AppData"
    foreach ($Sub in @("Local", "Roaming")) {
        $DR = Join-Path $SysProf $Sub
        if (-not (Test-Path $DR)) { continue }
        foreach ($D in (Get-ChildItem -Path $DR -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "orca*" })) {
            Remove-Tree $D.FullName
        }
    }
    foreach ($K in (Get-ArpKeys "*Orca*")) {
        foreach ($Hive in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\")) {
            Remove-Tree ($Hive + $K.PSChildName)
        }
    }
    foreach ($RK in @("HKLM:\SOFTWARE\Orca", "HKCU:\SOFTWARE\Orca")) {
        Remove-Tree $RK
    }

    # --- 4. Uninstall Moonlight (when present) ---------------------------------------
    $MlExeNow = Get-MoonlightExe
    $MlKeys = @(Get-ArpKeys "*Moonlight*")
    if (($MlExeNow -ne $null) -or ($MlKeys.Count -gt 0)) {
        $Winget = Get-Winget
        if ($Winget -ne $null) {
            Write-Info "Uninstalling Moonlight via winget..."
            try {
                $Mp = Start-Process -FilePath $Winget -ArgumentList @("uninstall", "--id", "MoonlightGameStreamingProject.Moonlight", "--exact", "--silent", "--disable-interactivity", "--accept-source-agreements") -Wait -PassThru
                Write-Info ("winget Moonlight uninstall finished (code {0})." -f $Mp.ExitCode)
            } catch { Write-Warn "winget Moonlight uninstall failed (continuing with fallback)." }
        }
        if ((Get-MoonlightExe) -ne $null) {
            foreach ($K in (Get-ArpKeys "*Moonlight*")) {
                $MU = $K.UninstallString
                if ([string]::IsNullOrWhiteSpace($MU)) { continue }
                $MU = $MU.Trim()
                if ($MU -match "(?i)msiexec") {
                    $Code = $K.PSChildName
                    Write-Info "Uninstalling Moonlight via msiexec..."
                    try { Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList ('/x {0} /qn /norestart' -f $Code) -Wait -PassThru | Out-Null } catch { }
                } else {
                    Write-Info "Uninstalling Moonlight via bundle uninstaller..."
                    try { Start-Process -FilePath "cmd.exe" -ArgumentList ('/c {0} /uninstall /quiet /norestart' -f $MU) -Wait -PassThru | Out-Null } catch { }
                }
            }
        }
        for ($i = 0; $i -lt 30; $i++) {
            if ((Get-MoonlightExe) -eq $null) { break }
            Start-Sleep -Seconds 2
        }
    } else {
        Write-Info "Moonlight not installed; skipping uninstaller."
    }
    Write-Info "Deleting Moonlight data..."
    foreach ($Pr in (Get-ChildItem -Path "C:\Users" -Directory -ErrorAction SilentlyContinue)) {
        foreach ($Sub in @("AppData\Local\Moonlight Game Streaming", "AppData\Roaming\Moonlight Game Streaming", "AppData\Local\Moonlight Game Streaming Project", "AppData\Roaming\Moonlight Game Streaming Project")) {
            Remove-Tree (Join-Path $Pr.FullName $Sub)
        }
    }
    foreach ($Sub in @("AppData\Local\Moonlight Game Streaming", "AppData\Roaming\Moonlight Game Streaming", "AppData\Local\Moonlight Game Streaming Project", "AppData\Roaming\Moonlight Game Streaming Project")) {
        Remove-Tree (Join-Path "C:\Windows\System32\config\systemprofile" $Sub)
    }
    foreach ($D in @((Join-Path $env:ProgramFiles "Moonlight Game Streaming"), (Join-Path ${env:ProgramFiles(x86)} "Moonlight Game Streaming"), (Join-Path $env:ProgramFiles "Moonlight Game Streaming Project"), (Join-Path ${env:ProgramFiles(x86)} "Moonlight Game Streaming Project"))) {
        Remove-Tree $D
    }
    foreach ($K in (Get-ArpKeys "*Moonlight*")) {
        foreach ($Hive in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\")) {
            Remove-Tree ($Hive + $K.PSChildName)
        }
    }
    foreach ($RK in @("HKCU:\SOFTWARE\Moonlight Game Streaming Project", "HKLM:\SOFTWARE\Moonlight Game Streaming Project")) {
        Remove-Tree $RK
    }

    # --- 5. Uninstall Tailscale (fixed; child script in ..\tailscale) -------------------
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

    # --- 6. Verify ----------------------------------------------------------------------
    Write-Info "Verifying..."
    $Remnants = @()
    if ((Get-OrcaExe) -ne $null) { $Remnants += "Orca.exe still present" }
    if ((Get-MoonlightExe) -ne $null) { $Remnants += "Moonlight.exe still present" }
    if ((Get-Service -Name "tailscale" -ErrorAction SilentlyContinue) -ne $null) { $Remnants += "service 'tailscale' still registered" }
    if (Test-Path $TailscaleExe) { $Remnants += "still exists: $TailscaleExe" }
    if (Test-Path $MoonlightReg) { $Remnants += "registry key still exists: $MoonlightReg" }
    foreach ($R in $Remnants) { Write-Warn $R; $Failures += $R }

    if ($OrcaWasPresent) {
        Write-Host ""
        Write-Host "DESKTOP STEP (do this at home): Orca > Settings > Remote Orca Servers >" -ForegroundColor Yellow
        Write-Host "Shared Server Access > revoke this PC grant." -ForegroundColor Yellow
    }

    if ($Failures.Count -eq 0) {
        Write-Info "Cleanup complete. No residue found."
        Finish 0
    } else {
        Write-Host ("[ERROR] Finished with {0} problem(s). See {1}" -f $Failures.Count, $LogFile) -ForegroundColor Red
        Finish 1
    }
}
