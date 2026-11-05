# Contributor Journey B environment for Windows (not auto-loaded by Node).
# Usage: . ./scripts/local/load-contributor-env.ps1
# Optional REMOTE_HTTP dev: . ./scripts/local/load-contributor-env.ps1 -RemoteHttpDev
# Secrets: read from gitignored .osva/* files; never printed to the console.

param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [switch]$RemoteHttpDev
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "contributor-stack-process.ps1")

$pgPort = Get-ContributorPostgresHostPort -RepoRoot $RepoRoot
if (-not $env:OSVA_POSTGRES_HOST_PORT) {
  $env:OSVA_POSTGRES_HOST_PORT = [string]$pgPort
}

if (-not $env:OSVA_DATABASE_URL) {
  $env:OSVA_DATABASE_URL = "postgres://osva:osva@127.0.0.1:$pgPort/osva"
}

if (-not $env:OSVA_VALKEY_URL) {
  $env:OSVA_VALKEY_URL = "redis://127.0.0.1:6379"
}

# Worker-only (do not export for M19.2 / Example 19 REMOTE_HTTP — TRUSTED root forces STDIO MCP).
$script:OsvaWorkerTrustedRuntimeRoot = Join-Path $RepoRoot "trusted-runtime"

if (-not $env:OSVA_ARTIFACT_FILESYSTEM_ROOT) {
  $env:OSVA_ARTIFACT_FILESYSTEM_ROOT = Join-Path $RepoRoot ".osva\artifacts"
}
if (-not $env:OSVA_ARTIFACT_STORAGE_DRIVER) {
  $env:OSVA_ARTIFACT_STORAGE_DRIVER = "filesystem"
}
if (-not $env:OSVA_ARTIFACT_MAX_BYTES) {
  $env:OSVA_ARTIFACT_MAX_BYTES = "67108864"
}
if (-not $env:OSVA_WEB_HOST) {
  $env:OSVA_WEB_HOST = "127.0.0.1"
}
if (-not $env:OSVA_WEB_PORT) {
  $env:OSVA_WEB_PORT = "3000"
}
if (-not $env:OSVA_KNOWLEDGE_EMBEDDING_PROVIDER) {
  $env:OSVA_KNOWLEDGE_EMBEDDING_PROVIDER = "DETERMINISTIC"
}
if (-not $env:OSVA_KNOWLEDGE_EMBEDDING_MODEL) {
  $env:OSVA_KNOWLEDGE_EMBEDDING_MODEL = "deterministic-v1"
}
if (-not $env:OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS) {
  $env:OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS = "384"
}

# Human auth (web + console)
if (-not $env:OSVA_AUTH_SECRET -or $env:OSVA_AUTH_SECRET.Length -lt 32) {
  $authFile = Join-Path $RepoRoot ".osva\auth-secret.txt"
  if (Test-Path $authFile) {
    $env:OSVA_AUTH_SECRET = (Get-Content $authFile -Raw).Trim()
  } else {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $env:OSVA_AUTH_SECRET = [Convert]::ToBase64String($bytes)
    Set-Content -Path $authFile -Value $env:OSVA_AUTH_SECRET -NoNewline
  }
}

$enableRemoteHttp = $RemoteHttpDev.IsPresent -or ($env:OSVA_REMOTE_HTTP_DEV_PROFILE -eq "true")
if ($enableRemoteHttp) {
  if (-not $env:OSVA_RUNTIME_CAPABILITY_SECRET) {
    $capFile = Join-Path $RepoRoot ".osva\runtime-capability-secret.txt"
    if (Test-Path $capFile) {
      $env:OSVA_RUNTIME_CAPABILITY_SECRET = (Get-Content $capFile -Raw).Trim()
    } else {
      $bytes = New-Object byte[] 32
      [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $env:OSVA_RUNTIME_CAPABILITY_SECRET = [Convert]::ToBase64String($bytes)
      Set-Content -Path $capFile -Value $env:OSVA_RUNTIME_CAPABILITY_SECRET -NoNewline
    }
  }
  $env:OSVA_RUNTIME_CAPABILITY_HOST = "127.0.0.1"
  $env:OSVA_RUNTIME_CAPABILITY_PORT = "8787"
  $env:OSVA_RUNTIME_CAPABILITY_BASE_URL = "http://127.0.0.1:8787"
  $env:OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS = "true"
  $env:OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS = "true"
}

$bootstrapPath = Join-Path $RepoRoot ".osva\bootstrap-output.txt"
if (Test-Path $bootstrapPath) {
  $lines = Get-Content $bootstrapPath
  $keyLine = $lines | Where-Object { $_ -match "^osva_ak_" } | Select-Object -First 1
  if ($keyLine -and -not $env:OSVA_API_KEY) {
    $env:OSVA_API_KEY = $keyLine.Trim()
  }
}

$localSecrets = Join-Path $RepoRoot ".osva\local-secrets.ps1"
if (Test-Path $localSecrets) {
  . $localSecrets
}

# Example 19 / M19.2 live defaults (host stack; no secrets)
if (-not $env:OSVA_BASE_URL) {
  $env:OSVA_BASE_URL = "http://127.0.0.1:3000"
}
if (-not $env:OSVA_AGENT_RUNTIME_URL) {
  $env:OSVA_AGENT_RUNTIME_URL = "http://127.0.0.1:8799/execute"
}
if (-not $env:OSVA_MCP_CONNECTOR_URL) {
  $env:OSVA_MCP_CONNECTOR_URL = "http://127.0.0.1:8798/mcp"
}
if (-not $env:OSVA_MODEL_PROFILE_VERSION_ID) {
  $env:OSVA_MODEL_PROFILE_VERSION_ID = "b992963f-1708-48a5-990e-144cec402259"
}

Write-Host "Contributor env loaded (PostgreSQL host port $pgPort, web :$($env:OSVA_WEB_PORT)). API key present: $($null -ne $env:OSVA_API_KEY -and $env:OSVA_API_KEY.Length -gt 0). REMOTE_HTTP dev profile: $enableRemoteHttp."
