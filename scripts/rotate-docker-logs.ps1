param(
  [ValidateRange(1, 167)]
  [int]$RetentionHours = 144,
  [string]$ComposeFile = 'docker-compose.yml',
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
  $containerIds = @(& docker compose -f $composePath ps -q)
  if ($LASTEXITCODE -ne 0) { throw 'docker compose ps failed.' }
  $containerIds = @($containerIds | Where-Object { $_ -match '^[a-f0-9]{12,64}$' })
  if ($containerIds.Count -eq 0) {
    Write-Output 'No running Compose containers found; nothing to rotate.'
    exit 0
  }

  $cutoff = [DateTimeOffset]::UtcNow.AddHours(-$RetentionHours)
  $staleContainers = @()
  foreach ($containerId in $containerIds) {
    $createdRaw = (& docker inspect --format '{{.Created}}' $containerId).Trim()
    if ($LASTEXITCODE -ne 0) { throw "docker inspect failed for container $containerId." }
    $createdAt = [DateTimeOffset]::Parse($createdRaw).ToUniversalTime()
    if ($createdAt -le $cutoff) {
      $staleContainers += $containerId
    }
  }

  if ($staleContainers.Count -eq 0) {
    Write-Output "All container logs are younger than $RetentionHours hours."
    exit 0
  }

  if ($DryRun) {
    Write-Output "Dry run: $($staleContainers.Count) container(s) require recreation."
    exit 0
  }

  # Compose removes the old containers and their driver-managed logs. Named
  # volumes and bind-mounted presentation content are preserved.
  & docker compose -f $composePath up -d --force-recreate --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw 'docker compose recreation failed.' }
  Write-Output "Recreated Compose services; logs older than $RetentionHours hours were removed with their containers."
} finally {
  Pop-Location
}
