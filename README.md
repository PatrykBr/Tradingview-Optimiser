# TradingView Strategy Optimiser

Automatically find optimal parameters for your TradingView strategies using Bayesian optimization.

No screenshots, no Selenium, no API keys — everything runs directly in your browser while Optuna intelligently searches the parameter space.

## Architecture

```
┌─────────────────┐      WebSocket       ┌─────────────────┐
│    Extension    │◄────────────────────►│     Backend     │
│  (Browser Tab)  │    localhost:8000    │  (Python/Optuna)│
└────────┬────────┘                      └─────────────────┘
         │
         │ DOM automation
         ▼
┌─────────────────┐
│   TradingView   │
│  Strategy Tester│
└─────────────────┘
```

The **extension** lives in your browser and automates TradingView's UI — opening dialogs, setting parameters, reading backtest results. The **backend** runs Optuna locally and decides which parameter combinations to try next based on previous results.

## Prerequisites

- Python 3.10+
- Node 18+
- Chrome or Firefox
- TradingView account (free works, Pro recommended for faster backtests)

## Quick Start

**1. Start the backend:**
```bash
cd backend
pip install -r requirements.lock
uvicorn app.main:app --port 8000
```

**2. Build and load the extension:**
```bash
cd extension
npm install && npm run build
```
Then load `extension/dist` as an unpacked extension in your browser.

**3. Go to TradingView**, open a chart with a strategy, click the extension icon, and run your first optimization.

## Directory Structure

```
tv-optimiser/
├── backend/          # FastAPI + Optuna optimization server
│   ├── app/          # Application code
│   └── README.md     # Backend-specific setup & config
│
├── extension/        # Manifest V3 browser extension
│   ├── src/          # React popup, content scripts, background worker
│   └── README.md     # Extension-specific setup & dev workflow
│
└── README.md         # You are here
```

See the README in each folder for detailed setup, environment variables, and development workflows.

## License

MIT
