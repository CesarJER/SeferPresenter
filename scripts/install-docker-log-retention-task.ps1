param(
  [string]$TaskName = 'SeferPresenter-Privacy-Log-Retention',
  [datetime]$NextRun = (Get-Date).AddDays(7)
)

$ErrorActionPreference = 'Stop'
$rotationScript = (Resolve-Path (Join-Path $PSScriptRoot 'rotate-docker-logs.ps1')).Path
$powerShellExecutable = (Get-Process -Id $PID).Path
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$rotationScript`" -DryRun"
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

& $rotationScript -DryRun
if ($LASTEXITCODE -notin @(0, 2)) { throw 'Docker log audit failed; scheduled task was not changed.' }

$action = New-ScheduledTaskAction -Execute $powerShellExecutable -Argument $arguments -WorkingDirectory (Split-Path $rotationScript -Parent)
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $NextRun.DayOfWeek -At $NextRun
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Audits SeferPresenter Docker logging without restarting services or deleting logs. Result 2 means retention needs operator review.' `
  -Force

Write-Output "Read-only log audit ran now. Scheduled task '$TaskName' will audit weekly from $($NextRun.ToString('yyyy-MM-dd HH:mm')); result 2 means operator review is needed."
