$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "Building TradeCopy Companion..."
    uv run --with "pyinstaller>=6.11,<7" pyinstaller --clean --noconfirm "TradeCopy-Companion.spec"

    $exe = Join-Path $PSScriptRoot "dist\TradeCopy Companion.exe"
    if (-not (Test-Path $exe)) {
        throw "Build completed but the companion executable was not found."
    }

    Write-Host ""
    Write-Host "Built:"
    Write-Host $exe
} finally {
    Pop-Location
}
