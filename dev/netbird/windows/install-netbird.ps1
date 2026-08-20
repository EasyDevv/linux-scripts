#requires -Version 5.1
param(
    [switch]$DryRun,
    [string]$Name,
    [string]$EnvFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$MsiName = "netbird_installer_windows_amd64.msi"
$WingetId = "NetBird.NetBird"
$NetbirdExe = Join-Path $env:ProgramFiles "NetBird\netbird.exe"
$DefaultManagementUrl = "https://management.example.invalid"
$Reserved = @("NETBIRD_API_KEY", "NETBIRD_MANAGEMENT_URL", "NETBIRD_AUTO_GROUP")
$KeyLinePattern = '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$'
$UsedKeyLinePattern = '^\s*#\s*(?:used\s+)?([A-Z][A-Z0-9_]*)=(.*)$'

function Get-EnvCandidates {
    $items = New-Object System.Collections.Generic.List[string]
    if ($EnvFile) {
        $items.Add($EnvFile)
    }
    $items.Add((Join-Path $ScriptRoot ".env.netbird.setup.keys"))
    $items.Add((Join-Path $ScriptRoot ".env.netbird.setup.key"))
    $items.Add((Join-Path $ScriptRoot ".env.netbird.setup-keys"))
    return $items
}

function Unquote-EnvValue {
    param([string]$Value)
    $trimmed = $Value.Trim()
    if (
        $trimmed.Length -ge 2 -and (
            ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or
            ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))
        )
    ) {
        return $trimmed.Substring(1, $trimmed.Length - 2)
    }
    return $trimmed
}

function Format-StruckText {
    param([string]$Text)
    $chars = New-Object System.Collections.Generic.List[string]
    foreach ($ch in $Text.ToCharArray()) {
        $chars.Add([string]$ch)
        $chars.Add([string][char]0x0336)
    }
    return (-join $chars)
}

function Read-SetupEnv {
    $path = $null
    foreach ($candidate in Get-EnvCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $path = $candidate
            break
        }
    }
    if (-not $path) {
        throw "setup keys file not found (.env.netbird.setup.keys)"
    }

    $active = [ordered]@{}
    $used = [ordered]@{}
    $order = New-Object System.Collections.Generic.List[string]
    $managementUrl = $DefaultManagementUrl
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match "^\s*#\s*management:\s*(\S+)") {
            $managementUrl = $Matches[1]
            continue
        }
        if ($line -match $UsedKeyLinePattern) {
            $keyName = $Matches[1]
            $value = Unquote-EnvValue $Matches[2]
            if ($Reserved -contains $keyName) {
                continue
            }
            if ($value -and -not $used.Contains($keyName) -and -not $active.Contains($keyName)) {
                $used[$keyName] = $value
                $order.Add($keyName)
            }
            continue
        }
        if ($line -match "^\s*#" -or $line -match "^\s*$") {
            continue
        }
        if ($line -match $KeyLinePattern) {
            $keyName = $Matches[1]
            $value = Unquote-EnvValue $Matches[2]
            if ($keyName -eq "NETBIRD_MANAGEMENT_URL" -and $value) {
                $managementUrl = $value
                continue
            }
            if ($Reserved -contains $keyName) {
                continue
            }
            if ($value) {
                $active[$keyName] = $value
                if ($used.Contains($keyName)) {
                    $used.Remove($keyName)
                }
                if (-not $order.Contains($keyName)) {
                    $order.Add($keyName)
                }
            }
        }
    }
    if ($active.Count -eq 0 -and $used.Count -eq 0) {
        throw "no setup keys in env file"
    }
    return @{
        Path          = $path
        Active        = $active
        Used          = $used
        Order         = $order
        ManagementUrl = $managementUrl
    }
}

function Disable-UsedSetupKey {
    param(
        [string]$Path,
        [string]$Name
    )
    $lines = New-Object System.Collections.Generic.List[string]
    $commented = $false
    foreach ($line in Get-Content -LiteralPath $Path) {
        if (-not $commented -and $line -match $KeyLinePattern) {
            if ($Matches[1] -eq $Name) {
                $lines.Add("# $line")
                $commented = $true
                continue
            }
        }
        $lines.Add($line)
    }
    if (-not $commented) {
        throw "could not mark setup key as used: $Name"
    }
    Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Select-SetupKeyName {
    param($EnvData)

    $active = $EnvData.Active
    $used = $EnvData.Used
    $names = @($EnvData.Order)
    if ($names.Count -eq 0) {
        $names = @($active.Keys) + @($used.Keys)
    }

    if ($Name) {
        $wanted = $Name.Trim().ToUpperInvariant()
        if ($wanted.StartsWith("NETBIRD_SETUP_KEY_")) {
            $wanted = $wanted.Substring("NETBIRD_SETUP_KEY_".Length)
        }
        if ($used.Contains($wanted) -and -not $active.Contains($wanted)) {
            throw "setup key already used: $wanted"
        }
        if (-not $active.Contains($wanted)) {
            throw "setup key not found: $wanted"
        }
        return $wanted
    }

    $interactive = $false
    try {
        $interactive = -not [Console]::IsInputRedirected
    } catch {
        $interactive = $false
    }
    if (-not $interactive) {
        throw "Name is required when stdin is not a TTY; pass -Name EXAMPLE_ADMIN_PC"
    }
    if ($active.Count -eq 0) {
        throw "no unused setup keys"
    }

    $index = 0
    while ($index -lt $names.Count -and $used.Contains($names[$index]) -and -not $active.Contains($names[$index])) {
        $index++
    }

    function Move-Index {
        param([int]$From, [int]$Step)
        $next = $From
        for ($n = 0; $n -lt $names.Count; $n++) {
            $next = ($next + $Step + $names.Count) % $names.Count
            $isUsed = $used.Contains($names[$next]) -and -not $active.Contains($names[$next])
            if (-not $isUsed) {
                return $next
            }
        }
        return $From
    }

    while ($true) {
        Clear-Host
        Write-Host "Select NetBird setup key"
        Write-Host ""
        for ($i = 0; $i -lt $names.Count; $i++) {
            $item = $names[$i]
            $isUsed = $used.Contains($item) -and -not $active.Contains($item)
            if ($isUsed) {
                $label = Format-StruckText "$item  used"
                Write-Host "  $label" -ForegroundColor DarkGray
            } elseif ($i -eq $index) {
                Write-Host ("> $item") -ForegroundColor Cyan
            } else {
                Write-Host ("  $item")
            }
        }
        Write-Host ""
        Write-Host "arrow/j k  move   enter select   q abort" -ForegroundColor DarkGray
        $keyInfo = [Console]::ReadKey($true)
        switch ($keyInfo.Key) {
            "UpArrow" { $index = Move-Index -From $index -Step -1 }
            "DownArrow" { $index = Move-Index -From $index -Step 1 }
            "Home" { $index = Move-Index -From -1 -Step 1 }
            "End" { $index = Move-Index -From $names.Count -Step -1 }
            "Enter" {
                $chosen = $names[$index]
                if ($used.Contains($chosen) -and -not $active.Contains($chosen)) {
                    continue
                }
                return $chosen
            }
            "Escape" { throw "aborted" }
            default {
                switch ($keyInfo.KeyChar) {
                    "k" { $index = Move-Index -From $index -Step -1 }
                    "j" { $index = Move-Index -From $index -Step 1 }
                    "g" { $index = Move-Index -From -1 -Step 1 }
                    "G" { $index = Move-Index -From $names.Count -Step -1 }
                    "q" { throw "aborted" }
                    "Q" { throw "aborted" }
                }
            }
        }
    }
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-NetBirdClient {
    $msi = Join-Path $ScriptRoot $MsiName
    if (Test-Path -LiteralPath $NetbirdExe) {
        Write-Host "NetBird already installed"
        return
    }
    if (Test-Path -LiteralPath $msi) {
        Write-Host "Installing NetBird from USB MSI..."
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $msi, "/quiet", "/norestart") -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "MSI install failed ($($proc.ExitCode))"
        }
        return
    }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "installer MSI missing and winget not found"
    }
    Write-Host "Installing NetBird with winget..."
    & $winget.Source install --id $WingetId -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "winget install failed"
    }
}

function Invoke-NetBirdUp {
    param($ManagementUrl, $SetupKey)
    if (-not (Test-Path -LiteralPath $NetbirdExe)) {
        throw "NetBird executable not found"
    }
    & $NetbirdExe up --management-url $ManagementUrl --setup-key $SetupKey
    if ($LASTEXITCODE -ne 0) {
        throw "netbird up failed"
    }
}

$envData = Read-SetupEnv
$selected = Select-SetupKeyName -EnvData $envData
Write-Host "selected $selected"

if ($DryRun) {
    $msi = Join-Path $ScriptRoot $MsiName
    if (Test-Path -LiteralPath $msi) {
        Write-Host "dry-run: msiexec /i $MsiName /quiet /norestart"
    } else {
        Write-Host "dry-run: winget install --id $WingetId"
    }
    Write-Host "dry-run: netbird up --management-url $($envData.ManagementUrl) --setup-key <$selected>"
    Write-Host "dry-run: comment out $selected in $($envData.Path)"
    exit 0
}

if (-not (Test-Admin)) {
    $argList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $PSCommandPath,
        "-Name", $selected
    )
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList | Out-Null
    exit 0
}

Install-NetBirdClient
Invoke-NetBirdUp -ManagementUrl $envData.ManagementUrl -SetupKey $envData.Active[$selected]
Disable-UsedSetupKey -Path $envData.Path -Name $selected
Write-Host "NetBird is up"
Write-Host "marked $selected as used"
if (-not $Name) {
    Write-Host ""
    Pause
}
