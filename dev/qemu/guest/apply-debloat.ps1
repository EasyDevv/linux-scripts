#Requires -RunAsAdministrator
# Apply the cached Win11Debloat preset from C:\Users\Docker\Scripts.
# Do not download from the internet. Do not read Shared after SSH exists.
# RunDefaults plus the forced-apps.txt list from the host cache.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Scripts = 'C:\Users\Docker\Scripts'
$LocalRoot = Join-Path $Scripts 'Win11Debloat'
$Marker = Join-Path $Scripts 'debloat.ok'
$Log = Join-Path $Scripts 'debloat.log'
$Ps51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ExtraLeftoverNames = @('Microsoft.XboxApp')

function Write-Log([string]$msg) {
    $line = ('{0} {1}' -f (Get-Date -Format o), $msg)
    try {
        if (-not (Test-Path -LiteralPath $Scripts)) {
            New-Item -ItemType Directory -Path $Scripts -Force | Out-Null
        }
        Add-Content -LiteralPath $Log -Value $line -Encoding utf8
    } catch {}
    Write-Host $line
}

function Get-DebloatScript {
    $local = Join-Path $LocalRoot 'Win11Debloat.ps1'
    if (Test-Path -LiteralPath $local) { return $local }
    $nested = Get-ChildItem -LiteralPath $LocalRoot -Filter Win11Debloat.ps1 -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($nested) { return $nested.FullName }
    throw 'Win11Debloat cache missing from C:\Users\Docker\Scripts\Win11Debloat'
}

function Get-CacheVersion {
    foreach ($path in @(
            (Join-Path $LocalRoot 'VERSION')
            (Join-Path $Scripts 'Win11Debloat.version')
        )) {
        if (Test-Path -LiteralPath $path) {
            return (Get-Content -LiteralPath $path -TotalCount 1).Trim()
        }
    }
    return $null
}

function Get-CachePreset {
    $path = Join-Path $LocalRoot 'PRESET'
    if (Test-Path -LiteralPath $path) {
        return (Get-Content -LiteralPath $path -TotalCount 1).Trim()
    }
    return $null
}

function Get-ForcedNames {
    $path = Join-Path $LocalRoot 'forced-apps.txt'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "missing $path"
    }
    return @(
        Get-Content -LiteralPath $path |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Get-Marker {
    if (-not (Test-Path -LiteralPath $Marker)) {
        return @{ version = ''; preset = '' }
    }
    $lines = @(Get-Content -LiteralPath $Marker | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $version = ''
    $preset = ''
    foreach ($line in $lines) {
        if ($line -match '^version=(.+)$') { $version = $Matches[1]; continue }
        if ($line -match '^preset=(.+)$') { $preset = $Matches[1]; continue }
        if (-not $version) { $version = $line }
    }
    return @{ version = $version; preset = $preset }
}

function Invoke-Win11Debloat([string]$script, [string[]]$extraArgs) {
    $argList = @(
        '-NoProfile'
        '-ExecutionPolicy'
        'Bypass'
        '-File'
        $script
    ) + $extraArgs
    $p = Start-Process -FilePath $Ps51 -ArgumentList $argList -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) {
        throw ("Win11Debloat failed exit={0}" -f $p.ExitCode)
    }
}

function Uninstall-ClassicOneDrive {
    $setup = @(
        (Join-Path $env:SystemRoot 'SysWOW64\OneDriveSetup.exe')
        (Join-Path $env:SystemRoot 'System32\OneDriveSetup.exe')
        (Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\OneDriveSetup.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $setup) {
        Write-Log 'classic OneDrive setup not present'
        return
    }
    Write-Log ("uninstall classic OneDrive via {0}" -f $setup)
    Get-Process | Where-Object { $_.Name -match 'OneDrive' } | Stop-Process -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $setup -ArgumentList '/uninstall' -Wait -PassThru -NoNewWindow
    Write-Log ("OneDriveSetup exit={0}" -f $p.ExitCode)
    $userOneDrive = Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive'
    if (Test-Path -LiteralPath $userOneDrive) {
        Remove-Item -LiteralPath $userOneDrive -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "removed $userOneDrive"
    }
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OneDrive' -ErrorAction SilentlyContinue
}

function Remove-LeftoverBloat([string[]]$names) {
    Get-Process | Where-Object { $_.Name -match 'OneDrive|Copilot|M365Copilot|Outlook' } | ForEach-Object {
        Write-Log ("stopping {0} pid={1}" -f $_.Name, $_.Id)
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($pkg in Get-AppxPackage -AllUsers | Where-Object { $names -contains $_.Name }) {
        Write-Log ("removing leftover package {0}" -f $pkg.PackageFullName)
        try { Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop } catch {}
        try { Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop } catch {}
    }
    foreach ($prov in Get-AppxProvisionedPackage -Online | Where-Object { $names -contains $_.DisplayName }) {
        Write-Log ("removing provisioned {0}" -f $prov.PackageName)
        try { Remove-AppxProvisionedPackage -Online -PackageName $prov.PackageName -ErrorAction Stop | Out-Null } catch {}
    }
    Uninstall-ClassicOneDrive
}

$force = $false
foreach ($arg in $args) {
    if ($arg -eq '-Force' -or $arg -eq '--force') { $force = $true }
}

$version = Get-CacheVersion
$preset = Get-CachePreset
$existing = Get-Marker
if ((-not $force) -and $existing.version -and $version -and $existing.version -eq $version -and $preset -and $existing.preset -eq $preset) {
    Write-Log ("skip already applied {0} preset={1}" -f $existing.version, $existing.preset)
    exit 0
}

$forcedNames = Get-ForcedNames
if ($forcedNames.Count -eq 0) {
    throw 'forced-apps.txt is empty'
}
$leftoverNames = @($forcedNames + $ExtraLeftoverNames | Select-Object -Unique)
$forcedApps = $forcedNames -join ','

New-Item -ItemType Directory -Path $Scripts -Force | Out-Null
$script = Get-DebloatScript

Write-Log ("applying RunDefaults from {0} version={1} preset={2}" -f $script, $version, $preset)
Invoke-Win11Debloat $script @('-RunDefaults', '-Silent')
Write-Log ("forcing app removal {0}" -f $forcedApps)
Invoke-Win11Debloat $script @('-RemoveApps', '-Apps', $forcedApps, '-Silent')
Remove-LeftoverBloat $leftoverNames

$stamp = @("version=$version", "preset=$preset")
Set-Content -LiteralPath $Marker -Value $stamp -Encoding ascii
Write-Log ("applied {0}" -f ($stamp -join ' '))
exit 0
