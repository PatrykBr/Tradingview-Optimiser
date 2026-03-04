$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$extensionDir = Join-Path $repoRoot 'extension'

Push-Location $extensionDir
try {
  npm run typecheck:ci
  if ($LASTEXITCODE -ne 0) { throw 'npm run typecheck:ci failed' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'npm run lint failed' }
}
finally {
  Pop-Location
}

Push-Location $backendDir
try {
  $venvPython = Join-Path $backendDir '.venv\Scripts\python.exe'
  $venvPyright = Join-Path $backendDir '.venv\Scripts\pyright.exe'
  if ((Test-Path $venvPython) -and (Test-Path $venvPyright)) {
    & $venvPython -m py_compile main.py optimizer.py models.py
    if ($LASTEXITCODE -ne 0) { throw '.venv python -m py_compile failed' }
    & $venvPyright main.py optimizer.py models.py
    if ($LASTEXITCODE -ne 0) { throw '.venv pyright failed' }
  }
  else {
    uv run python -m py_compile main.py optimizer.py models.py
    if ($LASTEXITCODE -ne 0) { throw 'uv run python -m py_compile failed' }
    uv run --extra dev pyright main.py optimizer.py models.py
    if ($LASTEXITCODE -ne 0) { throw 'uv run --extra dev pyright failed' }
  }
}
finally {
  Pop-Location
}

Write-Host '[check] All checks passed.'
