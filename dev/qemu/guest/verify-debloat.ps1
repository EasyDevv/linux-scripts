#Requires -RunAsAdministrator
# Fail if forced leftover apps are still installed. Do not treat inbox
# OneDriveSetup.exe as the OneDrive client.
$ErrorActionPreference = 'Stop'
$Scripts = 'C:\Users\Docker\Scripts'
$LocalRoot = Join-Path $Scripts 'Win11Debloat'
$Marker = Join-Path $Scripts 'debloat.ok'

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

$names = Get-ForcedNames
$left = @(Get-AppxPackage -AllUsers | Where-Object { $names -contains $_.Name } | Select-Object -ExpandProperty Name -Unique)
$procs = @(Get-Process | Where-Object { $_.Name -match 'OneDrive$|Copilot|M365Copilot|OutlookForWindows|YourPhone|WindowsCamera' } | Select-Object -ExpandProperty Name -Unique)
$marker = Get-Marker
$presetPath = Join-Path $LocalRoot 'PRESET'
$expectedPreset = ''
if (Test-Path -LiteralPath $presetPath) {
    $expectedPreset = (Get-Content -LiteralPath $presetPath -TotalCount 1).Trim()
}

Write-Host ('leftover_apps=' + ($(if ($left) { $left -join ',' } else { 'none' })))
Write-Host ('leftover_procs=' + ($(if ($procs) { $procs -join ',' } else { 'none' })))
Write-Host ('marker_version=' + ($(if ($marker.version) { $marker.version } else { 'missing' })))
Write-Host ('marker_preset=' + ($(if ($marker.preset) { $marker.preset } else { 'missing' })))
Write-Host ('expected_preset=' + ($(if ($expectedPreset) { $expectedPreset } else { 'missing' })))

if ($left.Count -gt 0 -or $procs.Count -gt 0) {
    exit 1
}
exit 0
