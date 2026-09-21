[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $HostName,
    [string] $UserName = "ftransfer",
    [string] $IdentityFile = "$env:USERPROFILE\.ssh\fizira_transfer",
    [string] $RemoteDirectory = "/home/ftransfer/fizira-backups",
    [string] $Destination = "$env:USERPROFILE\Fizira Backups",
    [ValidateRange(1, 3650)] [int] $RetentionDays = 90
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "SSH key not found: $IdentityFile"
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$staging = Join-Path $Destination ".incoming"
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$sshTarget = "${UserName}@${HostName}"
$listCommand = "find '$RemoteDirectory' -maxdepth 1 -type f -name 'fizira-backup-*.tar.enc.sha256' -printf '%f\n'"
$remoteChecksums = @(& ssh.exe -i $IdentityFile -o BatchMode=yes -o StrictHostKeyChecking=yes -- $sshTarget $listCommand)
if ($LASTEXITCODE -ne 0) {
    throw "SSH listing failed with exit code $LASTEXITCODE"
}

foreach ($checksumName in $remoteChecksums) {
    $checksumName = $checksumName.Trim()
    if ($checksumName -notmatch '^fizira-backup-[0-9]{8}T[0-9]{6}Z\.tar\.enc\.sha256$') {
        throw "Unexpected remote filename: $checksumName"
    }
    $archiveName = $checksumName -replace '\.sha256$', ''
    if ((Test-Path -LiteralPath (Join-Path $Destination $archiveName)) -and
        (Test-Path -LiteralPath (Join-Path $Destination $checksumName))) {
        continue
    }

    foreach ($fileName in @($archiveName, $checksumName)) {
        $remoteFile = "${sshTarget}:${RemoteDirectory}/${fileName}"
        & scp.exe -q -p -i $IdentityFile -o BatchMode=yes -o StrictHostKeyChecking=yes -- $remoteFile $staging
        if ($LASTEXITCODE -ne 0) {
            throw "SCP download failed for $fileName with exit code $LASTEXITCODE"
        }
    }
}

$verified = 0
Get-ChildItem -LiteralPath $staging -Filter "*.tar.enc.sha256" | ForEach-Object {
    $checksumFile = $_
    $archiveName = $checksumFile.Name -replace '\.sha256$', ''
    $archivePath = Join-Path $staging $archiveName
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "Archive is missing for checksum file: $($checksumFile.Name)"
    }

    $expected = ((Get-Content -LiteralPath $checksumFile.FullName -Raw).Trim() -split '\s+')[0].ToUpperInvariant()
    if ($expected -notmatch '^[0-9A-F]{64}$') {
        throw "Invalid checksum file: $($checksumFile.Name)"
    }
    $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -ne $expected) {
        throw "SHA-256 mismatch for $archiveName"
    }

    Move-Item -LiteralPath $archivePath -Destination (Join-Path $Destination $archiveName) -Force
    Move-Item -LiteralPath $checksumFile.FullName -Destination (Join-Path $Destination $checksumFile.Name) -Force
    $verified++
}

Get-ChildItem -LiteralPath $Destination -Filter "fizira-backup-*.tar.enc" -File |
    Where-Object LastWriteTimeUtc -lt ([DateTime]::UtcNow.AddDays(-$RetentionDays)) |
    ForEach-Object {
        $checksum = "$($_.FullName).sha256"
        Remove-Item -LiteralPath $_.FullName -Force
        if (Test-Path -LiteralPath $checksum) { Remove-Item -LiteralPath $checksum -Force }
    }

Write-Output "WINDOWS_BACKUP_PULL_OK verified=$verified destination=$Destination"
