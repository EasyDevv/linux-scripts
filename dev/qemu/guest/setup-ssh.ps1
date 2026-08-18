#Requires -RunAsAdministrator
# Install OpenSSH on this Windows guest and authorize the host pubkey.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PubKeyCandidates = @(
    'C:\Users\Docker\Desktop\Shared\scripts\windows-setup\windows.pub'
    '\\10.0.2.1\Data\scripts\windows-setup\windows.pub'
    '\\host.lan\Data\scripts\windows-setup\windows.pub'
    'Z:\scripts\windows-setup\windows.pub'
    'C:\Users\Docker\Desktop\Shared\windows.pub'
    '\\10.0.2.1\Data\windows.pub'
    '\\host.lan\Data\windows.pub'
    'Z:\windows.pub'
)
$StatusCandidates = @(
    'C:\Users\Docker\Desktop\Shared\scripts\windows-setup\ssh-setup.status'
    '\\10.0.2.1\Data\scripts\windows-setup\ssh-setup.status'
    '\\host.lan\Data\scripts\windows-setup\ssh-setup.status'
    'Z:\scripts\windows-setup\ssh-setup.status'
)
$ZipCandidates = @(
    'C:\Users\Docker\Desktop\Shared\scripts\windows-setup\OpenSSH-Win64.zip'
    '\\10.0.2.1\Data\scripts\windows-setup\OpenSSH-Win64.zip'
    '\\host.lan\Data\scripts\windows-setup\OpenSSH-Win64.zip'
    'Z:\scripts\windows-setup\OpenSSH-Win64.zip'
    'C:\Users\Docker\Desktop\Shared\OpenSSH-Win64.zip'
    '\\10.0.2.1\Data\OpenSSH-Win64.zip'
    '\\host.lan\Data\OpenSSH-Win64.zip'
    'Z:\OpenSSH-Win64.zip'
)
$SshDir = Join-Path $env:USERPROFILE '.ssh'
$AuthorizedKeys = Join-Path $SshDir 'authorized_keys'
$AdminKeys = 'C:\ProgramData\ssh\administrators_authorized_keys'
$SshdConfig = 'C:\ProgramData\ssh\sshd_config'
$InstallRoot = 'C:\Program Files\OpenSSH'

function Write-Status([string]$msg) {
    $line = '{0:o} {1}' -f (Get-Date), $msg
    foreach ($path in $StatusCandidates) {
        try {
            $dir = Split-Path -Parent $path
            if (Test-Path -LiteralPath $dir) {
                Add-Content -LiteralPath $path -Value $line -Encoding utf8
                break
            }
        } catch {}
    }
    Write-Host $line
}

function Get-SharedPubKey {
    foreach ($path in $PubKeyCandidates) {
        if (Test-Path -LiteralPath $path) {
            $line = (Get-Content -LiteralPath $path -TotalCount 1).Trim()
            if ($line -match '^ssh-(ed25519|rsa|dss|ecdsa)\s+\S+') {
                return [pscustomobject]@{ Path = $path; Line = $line }
            }
        }
    }
    throw 'windows.pub not found in shared folder'
}

function Get-SharedOpenSshZip {
    foreach ($path in $ZipCandidates) {
        if (Test-Path -LiteralPath $path) { return $path }
    }
    return $null
}

function Test-SshdPresent {
    if (Get-Service sshd -ErrorAction SilentlyContinue) { return $true }
    if (Test-Path -LiteralPath 'C:\Windows\System32\OpenSSH\sshd.exe') { return $true }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'sshd.exe')) { return $true }
    return $false
}

function Install-OpenSshFromZip([string]$zip) {
    Write-Status "installing OpenSSH from $zip"
    $tmp = Join-Path $env:TEMP 'OpenSSH-Win64'
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $src = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    if (-not $src) { $src = Get-Item -LiteralPath $tmp }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $src.FullName '*') -Destination $InstallRoot -Recurse -Force
    $install = Join-Path $InstallRoot 'install-sshd.ps1'
    if (Test-Path -LiteralPath $install) {
        & $install
    } else {
        New-Service -Name sshd -BinaryPathName (Join-Path $InstallRoot 'sshd.exe') -DisplayName 'OpenSSH SSH Server' -StartupType Automatic | Out-Null
    }
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if ($machinePath -notlike "*$InstallRoot*") {
        [Environment]::SetEnvironmentVariable('Path', "$machinePath;$InstallRoot", 'Machine')
    }
    Write-Status 'zip OpenSSH installed'
}

function Install-OpenSSH {
    if (Test-SshdPresent) {
        Write-Status 'OpenSSH already present'
        return
    }
    $zip = Get-SharedOpenSshZip
    if ($zip) {
        Install-OpenSshFromZip $zip
        if (Test-SshdPresent) { return }
    }
    Write-Status 'falling back to Windows capability'
    $cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1
    if (-not $cap) { throw 'OpenSSH.Server capability not found and zip install failed' }
    Write-Status ("capability {0} {1}" -f $cap.Name, $cap.State)
    if ($cap.State -ne 'Installed') {
        Add-WindowsCapability -Online -Name $cap.Name | Out-Null
    }
}

function Set-SshService {
    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd
    if (Get-Service ssh-agent -ErrorAction SilentlyContinue) {
        Set-Service -Name ssh-agent -StartupType Automatic -ErrorAction SilentlyContinue
        Start-Service ssh-agent -ErrorAction SilentlyContinue
    }
}

function Set-SshFirewall {
    $name = 'OpenSSH Server (sshd)'
    if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) { return }
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Enabled True | Out-Null
}

function Set-SshDefaultShell {
    $regPath = 'HKLM:\SOFTWARE\OpenSSH'
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    Set-ItemProperty -Path $regPath -Name DefaultShell -Value "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Force
}

function Set-AuthorizedKey([string]$line) {
    New-Item -ItemType Directory -Path $SshDir -Force | Out-Null
    icacls $SshDir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
    if (-not (Test-Path $AuthorizedKeys) -or -not (Select-String -LiteralPath $AuthorizedKeys -Pattern [regex]::Escape($line) -Quiet)) {
        Add-Content -LiteralPath $AuthorizedKeys -Value $line -Encoding ascii
    }
    icacls $AuthorizedKeys /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:F" | Out-Null

    $adminDir = Split-Path -Parent $AdminKeys
    New-Item -ItemType Directory -Path $adminDir -Force | Out-Null
    if (-not (Test-Path $AdminKeys) -or -not (Select-String -LiteralPath $AdminKeys -Pattern [regex]::Escape($line) -Quiet)) {
        Add-Content -LiteralPath $AdminKeys -Value $line -Encoding ascii
    }
    icacls $AdminKeys /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)" | Out-Null
}

function Set-SshdPubkey {
    if (-not (Test-Path $SshdConfig)) { return }
    $text = Get-Content -LiteralPath $SshdConfig -Raw
    $text = $text -replace '(?m)^#?\s*PasswordAuthentication\s+.*$', 'PasswordAuthentication no'
    $text = $text -replace '(?m)^#?\s*PubkeyAuthentication\s+.*$', 'PubkeyAuthentication yes'
    $text = $text -replace '(?m)^#?\s*AuthorizedKeysFile\s+.*$', 'AuthorizedKeysFile .ssh/authorized_keys'
    Set-Content -LiteralPath $SshdConfig -Value $text -Encoding ascii
    Restart-Service sshd
}

Write-Status 'started'
$key = Get-SharedPubKey
Write-Status "using $($key.Path)"
Install-OpenSSH
Write-Status 'openssh installed'
Set-SshService
Set-SshFirewall
Set-SshDefaultShell
Set-AuthorizedKey $key.Line
Set-SshdPubkey
$svc = Get-Service sshd
Write-Status ('sshd {0} {1}' -f $svc.Status, $svc.StartType)
Write-Host 'SSH setup complete'
