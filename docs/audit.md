# Codebase audit — 24 October 2026

Scope covered the extension UI and lifecycle, TradingView page bridge and report parsing, configuration and search spaces, trial sequencing and recovery, research stages, browser persistence, backend protocol and authentication, Optuna storage, dependency manifests, tests, documentation and Windows packaging.

The initial pass is recorded below, followed by the structural cleanup and Bun tooling migration.

## Deleted and simplified

- Replaced repetitive saved-draft migration code with the field lists already used for validation. Versioned migration and nested filter copies remain supported.
- Consolidated repeated date parsing and terminal-run predicates. Removed the unused `getBacktestMode` bridge action.
- Reused one Optuna RDB storage instance across studies and explicitly released its sessions and engine on shutdown. Each study previously constructed another pool and repeated storage initialization.
- Removed unused Optuna testing, visualization and CLI modules and SQLite test support from packaging discovery. The executable decreased from 42,158,414 to 41,272,965 bytes with the same build environment.
- Removed intermediate coordinates from flat chart segments while retaining their endpoints and improvement markers. A 100,000-point fixture renders four coordinates instead of 100,000.

## Correctness and UX fixes

- Concurrent backend connects share token loading. Events from replaced sockets cannot reject new requests, stop their heartbeat or reset authentication. Run commands wait for authentication; invalid envelopes report errors without crashing the listener.
- Abort replies include the failed outstanding trial so the browser's final history and exports match the backend's failure count.
- Report polling removes completed abort listeners. Trial execution checks cancellation before and after asynchronous stages. Hiding the panel preserves its mounted workflow and form state; teardown disposes the trial runner and bridge.
- Browser storage mutations execute in order within a content-script context. Delayed checkpoints cannot overwrite stop intent or resurrect finished runs. Concurrent research and analysis updates retain both results. Background run ownership finishes loading before routing or changing owners.
- Research candidates use distinct parameter sets. Stability variants stay on the configured grid and inside its bounds. Date parsing rejects impossible calendar dates, and research planning rejects single-day test folds before optimisation. Walk-forward folds cannot pass without an objective value. Monte Carlo waits for simulation completion before restoration and combines simulation and restoration failures correctly.
- Off-grid chart inputs are omitted from the baseline. The backend rejects invalid baselines and non-finite search/filter values, avoiding invalid trials and premature finite-space exhaustion.
- HTTP run reads require the paired bearer token, matching WebSocket authentication. Unicode credentials and malformed JSON produce controlled errors. Health checks and pairing remain accessible.
- Experiment loading and winner application are disabled while conflicting work runs. Added accessible names to pairing, configuration and trial controls, and an alert role to the main error message.
- Installation prepares WXT types; development and packaging select Python 3.12. Packaging now stops immediately if PyInstaller fails.

No dependencies were added or upgraded. Existing declared dependencies have active uses. TradingView metadata and DOM compatibility fallbacks were retained because they support dynamic page integrations.

## Validation

- 105 extension tests passed, including 21 additional cases; TypeScript passed with strict and unused-code checks.
- 48 backend tests passed, including 15 additional cases; Ruff passed.
- Chrome MV3 and Firefox MV2 production builds passed.
- Windows executable build and its packaged SQLite self-test passed.
- The packaged server passed a real local HTTP/WebSocket smoke test: authenticate, create a study, start a trial, submit metrics, read persisted results with authentication, reject unauthenticated reads and delete the study. Temporary processes and data were cleaned up.
- The delayed-checkpoint regression was also run against the original storage implementation and reproduced the bug; it passes with the queue.

## Remaining limits

- A signed-in TradingView session was not exercised. Page API and Deep Backtesting compatibility still need a real-account check; automated fixtures cannot guarantee future compatibility with TradingView's private internals.
- Browser recovery tracks one active optimisation across tabs. The mutation queue orders operations in one content-script context, not across separate tabs. Use one active TradingView tab.
- Most Optuna database and sampling operations still run synchronously in async handlers. Large-study latency was not benchmarked; an executor redesign was deferred rather than introduced without workload evidence.
- Existing saved runs with invalid baselines may now fail validation and need a new configuration. Valid saved-run and preset migrations remain covered.
- PyInstaller still reports missing optional `tzdata`, `pysqlite2` and `MySQLdb` imports. These warnings were not suppressed. SQLite packaging and the actual server flow passed; other database drivers are outside this application's requirements.
- The extension has no standalone lint configuration. Its configured TypeScript strict/unused checks and test suite were run; backend linting uses Ruff.

## Structural cleanup follow-up

- Deleted four production modules: the independent walk-forward and Monte Carlo runners, the separate trial executor, and the extension-context error helper. Their needed behavior now lives with research orchestration, trial execution and error classification respectively.
- Research has one entry point and one restoration scope. It runs OOS, stability, walk-forward and Monte Carlo in sequence, preserves cancellation and combined failures, and restores the parent chart only once. The full-stage fixture now makes four range preparations (three training folds and one restoration), down from six.
- Browser requests and WebSocket commands share one typed backend payload. Removed the eight command-specific `BackendClient` methods, background payload translation and duplicate trial transport adapters. Response types are inferred from the request, and event subscription lives in the message module.
- Fresh starts and history reruns use the same preparation/start operation, so busy state and errors cover the entire preparation period.
- Typed field definitions replace repeated settings markup and handlers. Labels, numeric limits, toggles, filters and editing locks remain covered. No general form framework or runtime dependency was introduced.
- Consolidated duplicated runner fixtures and added cross-stage, cancellation, command forwarding and settings coverage. User aborts still reach the backend before tab ownership finishes loading. All 117 extension tests and 48 backend tests pass, along with TypeScript, Ruff and Chrome/Firefox production builds.
- Extension production TypeScript decreased by about 2,500 lines across 55 to 51 files. Applying the same Prettier settings to both revisions shows about **865 lines of structural reduction**, with the rest from removing fragmented wrapping in edited files. Tests and documentation are excluded from these production counts.
- The Chrome production bundle decreased from about 382.38 kB to 372.60 kB in the same environment. No dependency changes or backend protocol changes were needed. A live TradingView account was still unavailable for validation; the earlier integration limits continue to apply.

## Bun tooling migration

- Replaced pnpm's workspace configuration and lockfile with Bun workspaces, an isolated dependency linker and `bun.lock`. Bun 1.4.4 is the tooling baseline. WXT prepare, development, builds and ZIP commands explicitly run under Bun.
- Removed Vitest and migrated all 117 tests to `bun:test`, using native mocks, spies and fake timers. Test files run in isolated globals and module registries. A small test fixture restores browser/WXT global descriptors after each case; polling timeout tests drain asynchronous continuations between virtual clock ticks and still exercise both timeout attempts.
- Replaced `tsc --noEmit` with native `bun check`. Browser and test configurations keep Bun declarations out of browser globals. TypeScript 7.0.2 remains as the matching editor dependency. Existing strictness and unused-code checks remain enabled.
- Added native formatting, format checking, watch tests, coverage, and a parallel `verify` command covering the extension and Python backend. Applied one formatter configuration across the extension and documentation, removing fragmented wrapping. Production React and browser logic changes are formatting-only.
- Bun's audit found seven advisories in the original build dependencies. Refreshed compatible dependencies to Vite 8.3.5 and source-map-js 1.2.2; the final audit reports no vulnerabilities. React, React DOM, WXT and the React build plugin retain their existing pinned runtime/build versions.
- Firefox source archives now contain the workspace manifest, Bun configuration and lockfile, so extracted sources rebuild with the locked dependency graph. Backend files, dependencies, generated output, coverage and test helpers are excluded.
- Validated all 117 extension tests in serial isolation, parallel isolation and coverage modes; both type configurations; formatting; all 48 Python tests and Ruff; Chrome/Firefox builds and ZIPs; and dev-server startup with an HTTP 200 response for the HMR client. Clean frozen installation generates WXT types and passes type checks with Node removed from PATH. The extracted Firefox source archive also installs and builds without Node.
- WXT remains responsible for browser packaging and Python remains responsible for Optuna. Bun's native linter is currently canary-only; stable development continues to use strict TypeScript checks and Ruff. A signed-in TradingView session and actual browser HMR reloads were not exercised during this migration. The Windows executable was not repackaged because its Python build inputs did not change.
