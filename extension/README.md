# Extension

## Runtime backend configuration

No auth/token configuration is required in local-only mode.

## Commands

```bash
npm ci
npm run dev
npm run typecheck:ci
npm run lint
npm run test
npm run build
```

## Privacy and retention

- Optimization history is size-limited before persistence to avoid storage quota failures.
- Persisted payloads are trimmed and may be reduced when storage limits are approached.
- To clear local extension state:

```js
await chrome.storage.local.remove('last_optimization_state');
```
