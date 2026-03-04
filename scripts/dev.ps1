param(
  [switch]$SkipBackend
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$extensionDir = Join-Path $repoRoot 'extension'

if (-not $SkipBackend) {
  $backendCommand = "Set-Location -LiteralPath '$backendDir'; uv run uvicorn main:app --host 127.0.0.1 --port 8765 --reload"
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoExit', '-Command', $backendCommand | Out-Null
  Start-Sleep -Seconds 1
}

Set-Location -LiteralPath $extensionDir
npm run dev
