from PyInstaller.utils.hooks import collect_submodules


hiddenimports = (
    collect_submodules("optuna")
    + collect_submodules("uvicorn.protocols")
    + collect_submodules("uvicorn.loops")
    + collect_submodules("uvicorn.lifespan")
    + collect_submodules("sqlalchemy.dialects.sqlite")
)

a = Analysis(
    ["companion.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TradeCopy Companion",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)
