# extension-new-2

## One-command local workflow

Start backend + extension dev server:

```powershell
pwsh -File scripts/dev.ps1
```

If backend is already running:

```powershell
pwsh -File scripts/dev.ps1 -SkipBackend
```

Run local checks (no test/auth requirements):

```powershell
pwsh -File scripts/check.ps1
```

## Manual setup

Backend:

```bash
uv sync --frozen --project backend
uv run --project backend uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload
```

Extension:

```bash
cd extension
npm ci
npm run dev
```

Optional backend extras:

```bash
uv sync --frozen --project backend --extra auto-sampler --extra sampler-gp --extra sampler-cmaes
```

`auto-sampler` is optional. If omitted, `sampler=auto` falls back to deterministic TPE locally.

Disclaimer: This software is provided for research and educational purposes only.
The author is not responsible for financial losses resulting from the use of this software.