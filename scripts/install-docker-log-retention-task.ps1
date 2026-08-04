param(
  [string]$TaskName = 'SeferPresenter-Privacy-Log-Retention',
  [datetime]$NextRun = (Get-Date).AddDays(7)
)

$ErrorActionPreference = 'Stop'
$rotationScript = (Resolve-Path (Join-Path $PSScriptRoot 'rotate-docker-logs.ps1')).Path
$powerShellExecutable = (Get-Process -Id $PID).Path
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$rotationScript`""
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

& $rotationScript

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
  -Description 'Recreates SeferPresenter Compose containers before seven days so Docker removes their bounded local logs.' `
  -Force

Write-Output "Scheduled task '$TaskName' ran now and will run weekly from $($NextRun.ToString('yyyy-MM-dd HH:mm'))."
