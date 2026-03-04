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
cd backend
uv sync --frozen
uv run uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

Extension:

```bash
cd extension
npm ci
npm run dev
```

Optional backend extras:

```bash
cd backend
uv sync --frozen --extra auto-sampler --extra sampler-gp --extra sampler-cmaes
```

`auto-sampler` is optional. If omitted, `sampler=auto` falls back to deterministic TPE locally.
