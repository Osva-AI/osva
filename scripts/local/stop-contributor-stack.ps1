# Stop contributor stack processes tracked in .osva/stack.pids.json
# Usage: .\scripts\local\stop-contributor-stack.ps1

param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
)

$ErrorActionPreference = "Continue"
$invokerPid = $PID

. (Join-Path $PSScriptRoot "contributor-stack-process.ps1")

$pidFile = Get-ContributorStackPidFile -RepoRoot $RepoRoot
if (-not (Test-Path $pidFile)) {
  Write-Host "No stack PID file at $pidFile"
  if ($PID -ne $invokerPid) {
    throw "Internal error: invoking shell PID changed during stop."
  }
  return
}

$document = Read-ContributorStackPidFile -PidFile $pidFile
$entries = Get-ContributorStackServiceEntries -Document $document
if ($entries.Count -eq 0) {
  Write-Host "Stack PID file is empty: $pidFile"
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  if ($PID -ne $invokerPid) {
    throw "Internal error: invoking shell PID changed during stop."
  }
  return
}

$fileRepoRoot = Resolve-ContributorStackRepoRoot -RepoRoot $RepoRoot -Document $document
$protected = Get-InvokerProcessIdSet

$remaining = @()
foreach ($entry in $entries) {
  $stopped = Stop-ContributorStackManagedProcess -Entry $entry -RepoRoot $fileRepoRoot -ProtectedProcessIds $protected
  if (-not $stopped) {
    $wrapperPid = if ($null -ne $entry.wrapperPid) { [int]$entry.wrapperPid } else { [int]$entry.pid }
    if (Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue) {
      $remaining += $entry
    }
  }
}

if ($remaining.Count -gt 0) {
  Write-ContributorStackPidFile -PidFile $pidFile -RepoRoot $fileRepoRoot -Entries $remaining
  Write-Host "Some services could not be stopped safely; PID file updated with $($remaining.Count) entr(ies)."
} else {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Contributor stack stopped. PID file removed."
}

if ($PID -ne $invokerPid) {
  throw "Internal error: invoking shell PID changed during stop (was $invokerPid, now $PID)."
}
