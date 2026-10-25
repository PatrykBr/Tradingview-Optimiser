from importlib.util import find_spec
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


optuna_spec = find_spec("optuna")
if optuna_spec is None or optuna_spec.origin is None:
    raise RuntimeError("Could not locate the installed Optuna package")

optuna_root = Path(optuna_spec.origin).resolve().parent
optuna_rdb = optuna_root / "storages" / "_rdb"
optuna_alembic = optuna_rdb / "alembic"
optuna_alembic_ini = optuna_rdb / "alembic.ini"

for required_path in (optuna_alembic, optuna_alembic_ini):
    if not required_path.exists():
        raise RuntimeError(
            f"Required Optuna RDB migration data is missing: {required_path}"
        )

datas = [
    (
        str(optuna_alembic_ini),
        "optuna/storages/_rdb",
    ),
    (
        str(optuna_alembic),
        "optuna/storages/_rdb/alembic",
    ),
]

hiddenimports = (
    collect_submodules(
        "optuna",
        filter=lambda name: not name.startswith(
            ("optuna.testing", "optuna.visualization", "optuna.cli")
        ),
    )
    + collect_submodules("uvicorn.protocols")
    + collect_submodules("uvicorn.loops")
    + collect_submodules("uvicorn.lifespan")
    + ["sqlalchemy.dialects.sqlite.pysqlite"]
)

a = Analysis(
    ["companion.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
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
