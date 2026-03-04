# Backend

## Local-only mode

This backend is configured for local development usage.
Auth tokens, admin tokens, and WebSocket origin/token checks are disabled.

Fixed local runtime guards:

- WebSocket receive timeout: `300s`.
- WebSocket message size limit: `256KB`.
- WebSocket per-connection message rate limit: `240/min`.
- Study/trial warm-start caps are fixed in code for predictable local behavior.

## Running

```bash
uv sync --frozen
uv run uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

## Optional extras

- `auto-sampler`: installs `optunahub` to enable OptunaHub AutoSampler. Without it, `sampler=auto` falls back to deterministic TPE.
- `sampler-gp`: installs `scipy` (`GPSampler` also requires `torch`).
- `sampler-cmaes`: installs `cmaes`.
- `gpu`: installs `torch`.

Example:

```bash
uv sync --frozen --extra auto-sampler --extra sampler-gp --extra sampler-cmaes --extra gpu
```

## Optional tests

```bash
uv run pytest
```
