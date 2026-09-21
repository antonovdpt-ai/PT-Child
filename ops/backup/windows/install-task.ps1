[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $HostName,
    [string] $UserName = "ftransfer",
    [string] $IdentityFile = "$env:USERPROFILE\.ssh\fizira_transfer",
    [string] $Destination = "$env:USERPROFILE\Fizira Backups",
    [ValidateRange(1, 3650)] [int] $RetentionDays = 90
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "pull-backups.ps1"
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "pull-backups.ps1 must be next to this installer"
}

$installDirectory = Join-Path $env:LOCALAPPDATA "FiziraBackup"
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$installedScript = Join-Path $installDirectory "pull-backups.ps1"
Copy-Item -LiteralPath $source -Destination $installedScript -Force

$arguments = @(
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", ('"{0}"' -f $installedScript),
    "-HostName", ('"{0}"' -f $HostName),
    "-UserName", ('"{0}"' -f $UserName),
    "-IdentityFile", ('"{0}"' -f $IdentityFile),
    "-Destination", ('"{0}"' -f $Destination),
    "-RetentionDays", $RetentionDays
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$daily = New-ScheduledTaskTrigger -Daily -At "12:00"
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "Fizira encrypted backup pull" -Action $action `
    -Trigger @($daily, $logon) -Settings $settings -Principal $principal -Force | Out-Null

& $installedScript -HostName $HostName -UserName $UserName -IdentityFile $IdentityFile `
    -Destination $Destination -RetentionDays $RetentionDays

Write-Output "WINDOWS_BACKUP_TASK_OK"
