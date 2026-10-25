$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "Building TradeCopy Companion..."
    uv run --with "pyinstaller>=6.11,<7" pyinstaller --clean --noconfirm "TradeCopy-Companion.spec"
    if ($LASTEXITCODE -ne 0) {
        throw "Companion build failed with exit code $LASTEXITCODE."
    }

    $exe = Join-Path $PSScriptRoot "dist\TradeCopy Companion.exe"
    if (-not (Test-Path $exe)) {
        throw "Build completed but the companion executable was not found."
    }

    Write-Host ""
    Write-Host "Running packaged Optuna storage self-test..."
    & $exe --self-test
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged companion self-test failed with exit code $LASTEXITCODE."
    }

    Write-Host ""
    Write-Host "Built and verified:"
    Write-Host $exe
} finally {
    Pop-Location
}
