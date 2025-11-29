# Backend — Optuna Optimization Server

FastAPI server that runs Optuna and communicates with the browser extension over WebSocket.

## Tech Stack

- **FastAPI** — async web framework
- **Optuna** — Bayesian hyperparameter optimization (AutoSampler by default, falls back to TPE)
- **OptunaHub** — for the AutoSampler package
- **WebSockets** — real-time bidirectional communication with the extension

## Setup

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.lock
```

## Environment Variables

Copy `env.example` to `.env`:

| Variable              | Default | Description                                                |
| --------------------- | ------- | ---------------------------------------------------------- |
| `OPTUNA_STORAGE`      | —       | SQLite URL to persist studies, e.g. `sqlite:///studies.db` |
| `OPTUNA_SAMPLER`      | `auto`  | `auto` (AutoSampler) or `tpe`                              |
| `OPTUNA_SAMPLER_SEED` | —       | Fix seed for reproducible runs                             |
| `CORS_ALLOW_ORIGINS`  | `*`     | Comma-separated origins, or `*` for all                    |

## Scripts

```bash
# Development (auto-reload)
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --port 8000
```

WebSocket endpoint: `ws://localhost:8000/optimise`

## Folder Structure

```
app/
├── main.py       # FastAPI app, WebSocket handler, optimization loop
├── schemas.py    # Pydantic models, metric mappings, Optuna distributions
└── __init__.py
```

## Adding New Metrics

1. Add to `METRIC_KEY_MAP` in `app/schemas.py`
2. Add matching key in `extension/src/shared/metrics.ts`
3. Add DOM selector in `extension/src/content/dom.ts`

Both sides must stay in sync.
