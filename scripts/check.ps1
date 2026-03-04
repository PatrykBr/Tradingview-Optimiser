$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$extensionDir = Join-Path $repoRoot 'extension'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Get-BackendPythonFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  if (Get-Command rg -ErrorAction SilentlyContinue) {
    try {
      $rgFiles = & rg --files backend -g "*.py" -g "!backend/.venv/**" -g "!backend/.uv-cache/**" -g "!backend/data/**" -g "!backend/.pytest_cache/**" 2>$null
      if ($LASTEXITCODE -eq 0 -and $null -ne $rgFiles -and @($rgFiles).Count -gt 0) {
        return @($rgFiles)
      }
    }
    catch {
      # Fall back to Get-ChildItem when rg exists but cannot run in this environment.
    }
  }

  return @(
    Get-ChildItem -Path (Join-Path $RepoRoot 'backend') -Recurse -Filter '*.py' -File |
      Where-Object {
        $_.FullName -notmatch '\\\.venv\\' -and
        $_.FullName -notmatch '\\\.uv-cache\\' -and
        $_.FullName -notmatch '\\data\\' -and
        $_.FullName -notmatch '\\\.pytest_cache\\'
      } |
      ForEach-Object { $_.FullName.Substring($RepoRoot.Length + 1) }
  )
}

Push-Location $extensionDir
try {
  Invoke-Checked -Command 'npm run typecheck:ci' -FailureMessage 'npm run typecheck:ci failed'
  Invoke-Checked -Command 'npm run lint' -FailureMessage 'npm run lint failed'
  Invoke-Checked -Command 'npm run test' -FailureMessage 'npm run test failed'
  Invoke-Checked -Command 'npm run audit' -FailureMessage 'npm run audit failed'
}
finally {
  Pop-Location
}

Push-Location $repoRoot
try {
  $pythonFiles = @(Get-BackendPythonFiles -RepoRoot $repoRoot)
  if ($pythonFiles.Count -eq 0) {
    throw 'No backend Python files found for py_compile.'
  }

  uv run --project backend --extra dev python -m py_compile @pythonFiles
  if ($LASTEXITCODE -ne 0) { throw 'backend py_compile failed' }

  Invoke-Checked `
    -Command 'uv run --project backend --extra dev pyright -p backend/pyrightconfig.json backend' `
    -FailureMessage 'backend pyright failed'
  Invoke-Checked `
    -Command 'uv run --project backend --extra dev ruff check --config backend/pyproject.toml backend' `
    -FailureMessage 'backend ruff failed'
  Invoke-Checked `
    -Command 'uv run --project backend --extra dev python -m pytest -q -p no:cacheprovider backend/tests' `
    -FailureMessage 'backend pytest failed'

  Push-Location $backendDir
  try {
    Invoke-Checked `
      -Command 'uv export --locked --format requirements-txt --no-hashes | Set-Content .audit-requirements.txt; uv run --with pip-audit pip-audit -r .audit-requirements.txt --strict; if (Test-Path .audit-requirements.txt) { Remove-Item .audit-requirements.txt }' `
      -FailureMessage 'backend pip-audit failed'
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}

Write-Host '[check] All checks passed.'
