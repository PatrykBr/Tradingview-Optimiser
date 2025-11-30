# Extension — TradingView Automation

Manifest V3 browser extension that automates TradingView's strategy tester. Works on Chrome and Firefox.

## Tech Stack

- **React**: popup UI
- **Tailwind CSS**: styling
- **Vite**: bundler
- **TypeScript**: type checking

## Setup

```bash
npm install
```

## Scripts

```bash
# Dev server for popup UI (localhost:5173)
npm run dev

# Production build
npm run build

# Type check
npm run typecheck
```

## Loading the Extension

After `npm run build`, load `dist/` as an unpacked extension:

- **Chrome**: `chrome://extensions` → Developer Mode → Load unpacked
- **Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on

## Folder Structure

```md
src/
├── background/     # Service worker, WebSocket to backend, message relay
├── content/        # Injected into TradingView, DOM automation
│   ├── dom.ts      # All CSS selectors live here
│   ├── tradingview.ts  # Strategy dialog, parameter reading/writing
│   └── index.ts    # Entry point, message handlers
├── popup/          # React UI
│   ├── components/ # Tabs: Strategy, Settings, Results
│   ├── state/      # Context, presets, session drafts
│   └── App.tsx     # Main component
└── shared/         # Types, IPC contracts, metric definitions
```

## Troubleshooting

**Strategy not detected?**  
Make sure the Strategy Tester panel is open. The extension reads from it.

**Parameters missing?**  
Open the strategy settings dialog manually once, then retry. Some strategies lazy-load inputs.

**WebSocket failed?**  
Check the backend is running on port 8000. Inspect the service worker: `chrome://extensions` → Details → Inspect views.

**Selectors broken after TradingView update?**  
All DOM selectors are in `src/content/dom.ts`. PRs welcome!
