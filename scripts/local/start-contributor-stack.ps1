# Start contributor stack processes with logs under .osva/logs/
# Usage: .\scripts\local\start-contributor-stack.ps1
#        .\scripts\local\start-contributor-stack.ps1 -RemoteHttpDev
# Stop:  .\scripts\local\stop-contributor-stack.ps1

param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [switch]$RemoteHttpDev,
  [switch]$SkipReadyWait
)

$ErrorActionPreference = "Stop"
$invokerPid = $PID

. (Join-Path $PSScriptRoot "load-contributor-env.ps1") -RepoRoot $RepoRoot -RemoteHttpDev:$RemoteHttpDev
. (Join-Path $PSScriptRoot "contributor-stack-process.ps1")

$pgPort = Get-ContributorPostgresHostPort -RepoRoot $RepoRoot
Test-ContributorDockerInfraHealthy -RepoRoot $RepoRoot -PostgresHostPort $pgPort

$logDir = Get-ContributorStackLogDir -RepoRoot $RepoRoot
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$pidFile = Get-ContributorStackPidFile -RepoRoot $RepoRoot

$existingDoc = Read-ContributorStackPidFile -PidFile $pidFile
$existingByName = @{}
foreach ($entry in (Get-ContributorStackServiceEntries -Document $existingDoc)) {
  $key = if ($entry.service) { $entry.service } else { $entry.name }
  if ($key) { $existingByName[$key] = $entry }
}

function Get-OrStart-Service {
  param([string]$Name)
  if ($existingByName.ContainsKey($Name)) {
    $existing = $existingByName[$Name]
    if (Test-ContributorStackEntryRunning -Entry $existing -RepoRoot $RepoRoot) {
      Write-Host "Already running: $Name (wrapper PID $($existing.wrapperPid))"
      return $existing
    }
    Write-Warning "Stale PID file entry for $Name (wrapper PID $($existing.wrapperPid)); starting a new process."
  }
  return Start-ContributorStackManagedProcess -Name $Name -RepoRoot $RepoRoot -LogDir $logDir -RemoteHttpDev:$RemoteHttpDev
}

$entries = @(
  (Get-OrStart-Service -Name "web")
  (Get-OrStart-Service -Name "worker")
  (Get-OrStart-Service -Name "scheduler")
  (Get-OrStart-Service -Name "workflow-orchestrator")
)

Write-ContributorStackPidFile -PidFile $pidFile -RepoRoot $RepoRoot -Entries $entries
Write-Host "Started: $(($entries | ForEach-Object { $_.service }) -join ', '). PIDs saved to $pidFile"
Write-Host "Logs: $logDir"

foreach ($entry in $entries) {
  $wrapperPid = [int]$entry.wrapperPid
  if (-not (Test-ContributorStackWrapperCommandLineSafe -ProcessId $wrapperPid)) {
    Write-Warning "Wrapper PID $wrapperPid for $($entry.service) may expose secrets on its command line; check process configuration."
  }
}

if (-not $SkipReadyWait) {
  $webBase = "http://$($env:OSVA_WEB_HOST):$($env:OSVA_WEB_PORT)"
  try {
    Wait-ContributorWebReady -BaseUrl $webBase -TimeoutSeconds 90 | Out-Null
    Write-Host "Web ready: $webBase/ready returned 200."
  } catch {
    Write-Warning $_.Exception.Message
    Write-Host "Check web logs: $(Join-Path $logDir 'web.err.log')"
  }
}

if ($PID -ne $invokerPid) {
  throw "Internal error: invoking shell PID changed during start (was $invokerPid, now $PID)."
}
