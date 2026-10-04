param(
  [ValidateRange(1, 167)]
  [int]$RetentionHours = 144,
  [string]$ComposeFile = 'docker-compose.yml',
  # Kept for existing callers. Every invocation is now a read-only audit.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ($env:SEFER_LOG_CONTAINER_MAX_AGE_HOURS) {
  $parsedHours = 0
  if (-not [int]::TryParse($env:SEFER_LOG_CONTAINER_MAX_AGE_HOURS, [ref]$parsedHours)) {
    throw 'SEFER_LOG_CONTAINER_MAX_AGE_HOURS must be an integer.'
  }
  if ($parsedHours -lt 1 -or $parsedHours -gt 167) {
    throw 'SEFER_LOG_CONTAINER_MAX_AGE_HOURS must be between 1 and 167.'
  }
  $RetentionHours = $parsedHours
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$composePath = (Resolve-Path (Join-Path $repositoryRoot $ComposeFile)).Path
$rootPrefix = $repositoryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $composePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'ComposeFile must resolve inside the SeferPresenter repository.'
}

Push-Location $repositoryRoot
try {
  # Include stopped/profile/override services in this project without changing
  # its effective Compose files, profiles, or running containers.
  $containerIds = @(& docker compose -f $composePath ps --all --quiet --orphans=true)
  if ($LASTEXITCODE -ne 0) { throw 'docker compose ps failed.' }
  $containerIds = @($containerIds | Where-Object { $_ -match '^[a-f0-9]{12,64}$' })
  if ($containerIds.Count -eq 0) {
    Write-Output 'No Compose containers found; nothing to audit.'
    exit 0
  }

  $cutoff = [DateTimeOffset]::UtcNow.AddHours(-$RetentionHours)
  $needsAttention = $false
  # Go raw strings also survive Windows PowerShell 5.1 native argument quoting.
  $metadataFormat = '{{.Created}}|{{index .Config.Labels `com.docker.compose.service`}}|{{.HostConfig.LogConfig.Type}}|{{index .HostConfig.LogConfig.Config `max-size`}}|{{index .HostConfig.LogConfig.Config `max-file`}}'
  foreach ($containerId in $containerIds) {
    # Read only logging metadata; never read credentials or log contents.
    $metadataRaw = & docker inspect --format $metadataFormat $containerId
    if ($LASTEXITCODE -ne 0) { throw "docker inspect failed for container $containerId." }
    $metadata = ($metadataRaw -join '') -split '\|'
    if ($metadata.Count -ne 5) { throw "Unexpected logging metadata for container $containerId." }
    $createdAt = [DateTimeOffset]::Parse($metadata[0]).ToUniversalTime()
    $service = $metadata[1]
    $driver = $metadata[2]
    if ($driver -eq 'none') { continue }

    $maxFiles = 0
    $hasExplicitBounds = $metadata[3] -match '^[1-9][0-9]*[kmg]?$' -and
      [int]::TryParse($metadata[4], [ref]$maxFiles) -and $maxFiles -gt 0
    # The local driver has bounded defaults even without explicit options.
    if ($driver -ne 'local' -and -not ($driver -eq 'json-file' -and $hasExplicitBounds)) {
      Write-Warning "$($service): log size limits cannot be confirmed for driver '$driver'. Review logging configuration during planned maintenance."
      $needsAttention = $true
    }
    if ($createdAt -le $cutoff) {
      Write-Warning "$($service): container exceeds $RetentionHours hours; its logs may exceed the time-retention policy. Review during planned maintenance; container age does not establish log age."
      $needsAttention = $true
    }
  }

  # Docker rotates local/json-file logs by size, not elapsed time, and owns
  # their internal files. Never truncate them or interrupt sessions to erase
  # them. A strict time limit needs a separate reviewed logging policy.
  Write-Output 'Audit only: no containers or logs changed. Size rotation does not guarantee time-based deletion.'
  if ($needsAttention) { exit 2 }
  exit 0
} finally {
  Pop-Location
}
