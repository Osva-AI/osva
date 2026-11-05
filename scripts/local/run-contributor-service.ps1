# Managed contributor stack service entry (one process per invocation).
# Started via Start-Process -File; secrets come from inherited env and gitignored .osva/* via load-contributor-env.ps1.

param(
  [Parameter(Mandatory)]
  [ValidateSet("web", "worker", "scheduler", "workflow-orchestrator")]
  [string]$Service,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [switch]$RemoteHttpDev
)

$ErrorActionPreference = "Stop"

$env:OSVA_CONTRIBUTOR_STACK_SERVICE = $Service
$env:OSVA_CONTRIBUTOR_STACK_ROOT = $RepoRoot

. (Join-Path $PSScriptRoot "load-contributor-env.ps1") -RepoRoot $RepoRoot -RemoteHttpDev:$RemoteHttpDev

if ($Service -eq "worker" -and -not $env:OSVA_TRUSTED_RUNTIME_ROOT) {
  $env:OSVA_TRUSTED_RUNTIME_ROOT = Join-Path $RepoRoot "trusted-runtime"
}

Set-Location $RepoRoot

switch ($Service) {
  "web" { pnpm --filter @osva/web dev; break }
  "worker" { pnpm --filter @osva/worker dev; break }
  "scheduler" { pnpm --filter @osva/scheduler dev; break }
  "workflow-orchestrator" { pnpm --filter @osva/workflow-orchestrator dev; break }
}
