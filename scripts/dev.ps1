param(
  [switch]$SkipBackend
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $repoRoot 'extension'

if (-not $SkipBackend) {
  $backendDir = Join-Path $repoRoot 'backend'
  $backendCommand = "Set-Location -LiteralPath '$repoRoot'; uv run --project backend uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload --reload-dir '$backendDir'"
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoExit', '-Command', $backendCommand | Out-Null
  Start-Sleep -Seconds 1
}

Set-Location -LiteralPath $extensionDir
if (-not (Test-Path 'node_modules')) {
  Write-Host 'Installing frontend dependencies...'
  npm install
}
npm run dev
