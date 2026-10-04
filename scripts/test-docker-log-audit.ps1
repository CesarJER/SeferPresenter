$ErrorActionPreference = 'Stop'
$auditScript = Join-Path $PSScriptRoot 'rotate-docker-logs.ps1'
$savedAge = $env:SEFER_LOG_CONTAINER_MAX_AGE_HOURS
$env:SEFER_LOG_CONTAINER_MAX_AGE_HOURS = $null
$global:auditCalls = @()
$global:auditRows = @{}

# All Docker calls are mocked: this check cannot contact or restart services.
function docker {
  $global:LASTEXITCODE = 0
  $global:auditCalls += ,@($args)
  if ($args[0] -eq 'compose' -and $args[3] -eq 'ps') {
    if ($args -notcontains '--all' -or $args -notcontains '--orphans=true') {
      throw 'Audit must include stopped and override/profile services.'
    }
    return @($global:auditRows.Keys)
  }
  if ($args[0] -eq 'inspect' -and $args[1] -eq '--format') {
    return $global:auditRows[$args[3]]
  }
  throw "Unexpected Docker command: $($args -join ' ')"
}

function Assert-Audit([string]$name, [hashtable]$rows, [int]$expectedCode) {
  $global:auditRows = $rows
  $global:auditCalls = @()
  & $auditScript -DryRun 3>$null | Out-Null
  if ($LASTEXITCODE -ne $expectedCode) { throw "$name returned $LASTEXITCODE; expected $expectedCode." }
  if ($global:auditCalls.Count -ne 1 + $rows.Count) { throw "$name omitted a container or called extra commands." }
}

try {
  $fresh = [DateTimeOffset]::UtcNow.ToString('o')
  $old = [DateTimeOffset]::UtcNow.AddDays(-10).ToString('o')
  $appId = 'a' * 64
  $overrideId = 'b' * 64
  Assert-Audit 'fresh bounded logs and old disabled logs' @{
    $appId = "$fresh|app|local|5m|3"
    $overrideId = "$old|livekit|none||"
  } 0
  Assert-Audit 'old logged container requests review without restart' @{
    $appId = "$old|app|local|5m|3"
  } 2
  Assert-Audit 'unbounded json-file requests review' @{
    $appId = "$fresh|app|json-file||"
  } 2
  Assert-Audit 'bounded json-file' @{
    $appId = "$fresh|app|json-file|5m|3"
  } 0
  Assert-Audit 'no containers' @{} 0
  Write-Output 'PASS: read-only Docker log audit includes overrides, checks bounds, and reports attention without mutations.'
} finally {
  $env:SEFER_LOG_CONTAINER_MAX_AGE_HOURS = $savedAge
  Remove-Item Function:\docker
  Remove-Variable auditCalls, auditRows -Scope Global
}
