# Shared contributor stack process tracking and safe termination (Windows).
# Dot-source from start/stop scripts; do not invoke directly.

function Get-ContributorStackPidFile {
  param([string]$RepoRoot)
  Join-Path $RepoRoot ".osva\stack.pids.json"
}

function Get-ContributorStackLogDir {
  param([string]$RepoRoot)
  Join-Path $RepoRoot ".osva\logs"
}

function Get-InvokerProcessIdSet {
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  $current = $PID
  for ($i = 0; $i -lt 32; $i++) {
    if (-not $ids.Add($current)) { break }
    try {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop
    } catch {
      break
    }
    $parent = [int]$proc.ParentProcessId
    if ($parent -le 0 -or $parent -eq $current) { break }
    $current = $parent
  }
  return $ids
}

function Get-Win32ProcessById {
  param([int]$ProcessId)
  Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Get-ProcessStartTimeUtc {
  param([int]$ProcessId)
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  return $p.StartTime.ToUniversalTime()
}

function Get-ContributorStackServiceFilter {
  param([string]$ServiceName)
  switch ($ServiceName) {
    "web" { return "@osva/web" }
    "worker" { return "@osva/worker" }
    "scheduler" { return "@osva/scheduler" }
    "workflow-orchestrator" { return "@osva/workflow-orchestrator" }
    default { return $null }
  }
}

function Resolve-ContributorStackRepoRoot {
  param(
    [string]$RepoRoot,
    $Document
  )
  if ($Document -and $Document.repoRoot -and -not [string]::IsNullOrWhiteSpace([string]$Document.repoRoot)) {
    return [string]$Document.repoRoot
  }
  return $RepoRoot
}

function Get-ContributorStackLauncherScriptPath {
  param([Parameter(Mandatory)][string]$RepoRoot)
  Join-Path $RepoRoot "scripts\local\run-contributor-service.ps1"
}

function Test-ContributorStackWrapperCommandLineSafe {
  param([Parameter(Mandatory)][int]$ProcessId)

  $win32 = Get-Win32ProcessById -ProcessId $ProcessId
  if (-not $win32) { return $false }

  $cmd = [string]$win32.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }

  if ($cmd -match '\s-Command(\s|$)') { return $false }

  $secretPatterns = @(
    'OSVA_AUTH_SECRET=',
    'OSVA_RUNTIME_CAPABILITY_SECRET=',
    'OPENAI_API_KEY=',
    'osva_ak_',
    'postgres://[^"\s]+:[^"\s]+@'
  )
  foreach ($pattern in $secretPatterns) {
    if ($cmd -match $pattern) { return $false }
  }

  return $true
}

function Test-ContributorStackProcessIdentity {
  param(
    [Parameter(Mandatory)]
    [pscustomobject]$Entry,
    [Parameter(Mandatory)]
    [string]$RepoRoot,
    [int]$ProcessId
  )

  $win32 = Get-Win32ProcessById -ProcessId $ProcessId
  if (-not $win32) { return $false }

  $name = $Entry.name
  $expectedService = if ($Entry.service) { $Entry.service } else { $name }
  $cmd = [string]$win32.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }

  $repoNorm = $RepoRoot.TrimEnd('\')
  $hasMarker = $cmd -match 'OSVA_CONTRIBUTOR_STACK_SERVICE' -and $cmd -match [regex]::Escape($expectedService)
  $hasRepo = $cmd -match [regex]::Escape($repoNorm)
  if (-not $hasRepo) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      if ([string]$child.CommandLine -match [regex]::Escape($repoNorm)) {
        $hasRepo = $true
        break
      }
    }
  }
  $filter = Get-ContributorStackServiceFilter -ServiceName $expectedService
  $hasFilter = $filter -and ($cmd -match [regex]::Escape($filter))
  $expectedOut = (Join-Path $RepoRoot ".osva\logs\$expectedService.out.log").ToLowerInvariant()
  $entryOut = if ($Entry.out) { ([string]$Entry.out).ToLowerInvariant() } else { "" }
  $hasLogAnchor = ($entryOut -eq $expectedOut) -and ($win32.Name -eq "powershell.exe")
  $legacyOk = ($hasRepo -and $hasFilter) -or ($hasLogAnchor -and $hasFilter)
  $launcherPath = Get-ContributorStackLauncherScriptPath -RepoRoot $RepoRoot
  $launcherName = [System.IO.Path]::GetFileName($launcherPath)
  $launcherOk = $cmd -match [regex]::Escape($launcherName) -and (
    $cmd -match [regex]::Escape("-Service $expectedService") -or
    $cmd -match [regex]::Escape("-Service `"$expectedService`"")
  ) -and $hasRepo
  $modernOk = ($hasMarker -and $hasRepo) -or $launcherOk
  if (-not ($legacyOk -or $modernOk)) { return $false }

  if ($Entry.startedAtUtc) {
    $expected = [datetime]::Parse($Entry.startedAtUtc, $null, [Globalization.DateTimeStyles]::RoundtripKind)
    $actual = Get-ProcessStartTimeUtc -ProcessId $ProcessId
    if (-not $actual) { return $false }
    $delta = [Math]::Abs(($actual - $expected).TotalSeconds)
    if ($delta -gt 3) { return $false }
  }

  return $true
}

function Get-ContributorStackDescendantIds {
  param(
    [Parameter(Mandatory)]
    [int]$RootProcessId,
    [Parameter(Mandatory)]
    [string]$RepoRoot
  )

  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  if (-not $all) { return @() }

  $byParent = @{}
  foreach ($p in $all) {
    $parent = [int]$p.ParentProcessId
    if (-not $byParent.ContainsKey($parent)) {
      $byParent[$parent] = [System.Collections.Generic.List[int]]::new()
    }
    $byParent[$parent].Add([int]$p.ProcessId)
  }

  $descendants = [System.Collections.Generic.List[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($RootProcessId)
  $repoNorm = $RepoRoot.TrimEnd('\')

  while ($queue.Count -gt 0) {
    $parentId = $queue.Dequeue()
    if (-not $byParent.ContainsKey($parentId)) { continue }
    foreach ($childId in $byParent[$parentId]) {
      if ($childId -eq $RootProcessId) { continue }
      $win32 = $all | Where-Object { [int]$_.ProcessId -eq $childId } | Select-Object -First 1
      if (-not $win32) { continue }
      $cmd = [string]$win32.CommandLine
      if ($cmd -match [regex]::Escape($repoNorm) -or $cmd -match '@osva/') {
        if (-not $descendants.Contains($childId)) {
          $descendants.Add($childId)
          $queue.Enqueue($childId)
        }
      }
    }
  }

  return $descendants
}

function Stop-ContributorStackManagedProcess {
  param(
    [Parameter(Mandatory)]
    [pscustomobject]$Entry,
    [Parameter(Mandatory)]
    [string]$RepoRoot,
    [Parameter(Mandatory)]
    [System.Collections.Generic.HashSet[int]]$ProtectedProcessIds
  )

  $wrapperPid = if ($null -ne $Entry.wrapperPid) { [int]$Entry.wrapperPid } else { [int]$Entry.pid }
  $serviceName = if ($Entry.service) { $Entry.service } else { $Entry.name }

  if ($ProtectedProcessIds.Contains($wrapperPid)) {
    Write-Warning "Skipping $serviceName (PID $wrapperPid): matches invoking process chain."
    return $false
  }

  if (-not (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue)) {
    Write-Host "Already stopped: $serviceName (PID $wrapperPid)"
    return $true
  }

  if (-not (Test-ContributorStackProcessIdentity -Entry $Entry -RepoRoot $RepoRoot -ProcessId $wrapperPid)) {
    Write-Warning "Skipping $serviceName (PID $wrapperPid): PID reuse or process identity mismatch."
    return $false
  }

  $childIds = Get-ContributorStackDescendantIds -RootProcessId $wrapperPid -RepoRoot $RepoRoot
  $stopOrder = @($childIds | Sort-Object -Descending)
  foreach ($childId in $stopOrder) {
    if ($ProtectedProcessIds.Contains($childId)) { continue }
    if (-not (Get-Process -Id $childId -ErrorAction SilentlyContinue)) { continue }
    $childWin32 = Get-Win32ProcessById -ProcessId $childId
    $childCmd = if ($childWin32) { [string]$childWin32.CommandLine } else { "" }
    $repoNorm = $RepoRoot.TrimEnd('\')
    if ($childCmd -match [regex]::Escape($repoNorm) -or $childCmd -match '@osva/') {
      Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
    }
  }

  if (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue) {
    Stop-Process -Id $wrapperPid -Force -ErrorAction SilentlyContinue
  }

  Write-Host "Stopped $serviceName (wrapper PID $wrapperPid)"
  return $true
}

function Start-ContributorStackManagedProcess {
  param(
    [Parameter(Mandatory)]
    [string]$Name,
    [Parameter(Mandatory)]
    [string]$RepoRoot,
    [Parameter(Mandatory)]
    [string]$LogDir,
    [switch]$RemoteHttpDev
  )

  $launcher = Get-ContributorStackLauncherScriptPath -RepoRoot $RepoRoot
  if (-not (Test-Path $launcher)) {
    throw "Missing contributor launcher script: $launcher"
  }

  $outLog = Join-Path $LogDir "$Name.out.log"
  $errLog = Join-Path $LogDir "$Name.err.log"

  $argumentList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $launcher,
    "-RepoRoot", $RepoRoot,
    "-Service", $Name
  )
  if ($RemoteHttpDev) {
    $argumentList += "-RemoteHttpDev"
  }

  $proc = Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $RepoRoot `
    -ArgumentList $argumentList `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

  Start-Sleep -Milliseconds 200
  $startedAt = Get-ProcessStartTimeUtc -ProcessId $proc.Id
  $startedAtUtc = if ($startedAt) { $startedAt.ToString("o") } else { (Get-Date).ToUniversalTime().ToString("o") }

  return [pscustomobject]@{
    name          = $Name
    service       = $Name
    wrapperPid    = $proc.Id
    pid           = $proc.Id
    startedAtUtc  = $startedAtUtc
    repoRoot      = $RepoRoot
    out           = $outLog
    err           = $errLog
  }
}

function Read-ContributorStackPidFile {
  param([string]$PidFile)
  if (-not (Test-Path $PidFile)) { return $null }
  $raw = Get-Content $PidFile -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Get-ContributorStackServiceEntries {
  param($Document)
  if ($null -eq $Document) { return @() }
  if ($Document.PSObject.Properties.Name -contains "services") {
    return @($Document.services)
  }
  if ($Document -is [System.Array]) {
    return @($Document)
  }
  if ($Document.PSObject.Properties.Name -contains "name") {
    return @($Document)
  }
  return @()
}

function Test-ContributorStackEntryRunning {
  param(
    [pscustomobject]$Entry,
    [string]$RepoRoot
  )
  $wrapperPid = if ($null -ne $Entry.wrapperPid) { [int]$Entry.wrapperPid } else { [int]$Entry.pid }
  if (-not (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue)) { return $false }
  return Test-ContributorStackProcessIdentity -Entry $Entry -RepoRoot $RepoRoot -ProcessId $wrapperPid
}

function Write-ContributorStackPidFile {
  param(
    [string]$PidFile,
    [string]$RepoRoot,
    [array]$Entries
  )
  $payload = [pscustomobject]@{
    version  = 2
    repoRoot = $RepoRoot
    services = $Entries
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $PidFile -Encoding utf8
}

function Get-ContributorPostgresHostPort {
  param([string]$RepoRoot)

  if ($env:OSVA_POSTGRES_HOST_PORT -and $env:OSVA_POSTGRES_HOST_PORT -match '^\d+$') {
    return [int]$env:OSVA_POSTGRES_HOST_PORT
  }

  if ($env:OSVA_DATABASE_URL -match '@127\.0\.0\.1:(\d+)/') {
    return [int]$Matches[1]
  }

  $overridePath = Join-Path $RepoRoot "docker-compose.override.yml"
  if (Test-Path $overridePath) {
    $overrideText = Get-Content $overridePath -Raw
    if ($overrideText -match '127\.0\.0\.1:(\d+):5432') {
      return [int]$Matches[1]
    }
  }

  return 5432
}

function Test-ContributorDockerInfraHealthy {
  param(
    [Parameter(Mandatory)]
    [string]$RepoRoot,
    [int]$PostgresHostPort = 5432
  )

  $composeFile = Join-Path $RepoRoot "docker-compose.yml"
  if (-not (Test-Path $composeFile)) {
    throw "Missing docker-compose.yml at $composeFile"
  }

  Push-Location $RepoRoot
  try {
    $psOutput = docker compose ps --format json 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose ps failed (exit $LASTEXITCODE): $psOutput"
    }
  } finally {
    Pop-Location
  }

  $lines = @($psOutput | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  if ($lines.Count -eq 0) {
    throw "No Docker Compose services running. From repo root: pnpm infra:up"
  }

  $postgresHealthy = $false
  $valkeyHealthy = $false
  foreach ($line in $lines) {
    try {
      $row = $line | ConvertFrom-Json
    } catch {
      continue
    }
    $service = [string]$row.Service
    $health = [string]$row.Health
    $state = [string]$row.State
    $isHealthy = ($health -eq "healthy") -or ($state -eq "running" -and [string]::IsNullOrWhiteSpace($health))
    if ($service -eq "postgres" -and $isHealthy) { $postgresHealthy = $true }
    if ($service -eq "valkey" -and $isHealthy) { $valkeyHealthy = $true }
  }

  if (-not $postgresHealthy) {
    throw "PostgreSQL (Compose service postgres) is not healthy. Check: docker compose ps"
  }
  if (-not $valkeyHealthy) {
    throw "Valkey (Compose service valkey) is not healthy. Check: docker compose ps"
  }

  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $PostgresHostPort)
    $tcp.Close()
  } catch {
    throw "PostgreSQL is not accepting TCP on 127.0.0.1:${PostgresHostPort}. Set OSVA_POSTGRES_HOST_PORT / OSVA_DATABASE_URL to match docker-compose port mapping."
  }
}

function Wait-ContributorWebReady {
  param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $ready = Invoke-WebRequest -Uri "$BaseUrl/ready" -UseBasicParsing -TimeoutSec 5
      if ($ready.StatusCode -eq 200) {
        return $true
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  }
  throw "Timed out waiting for $BaseUrl/ready. Last error: $lastError"
}
