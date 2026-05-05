# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GEX Dash — real-time Gamma Exposure visualization for equities/index options using the Schwab API. Express/TypeScript backend, vanilla JS + Three.js frontend (no bundler). Mobile PWA at `/mobile`.

## Commands

```bash
npm run dev          # tsx watch src/server.ts — auto-reload development server
npm run build        # tsc && copy public/ to dist/
npm start            # node dist/server.js (run build first)
docker compose up --build  # full containerized run
```

Server runs at `https://127.0.0.1:3000` (HTTPS required for Schwab OAuth; self-signed certs auto-generated). Mobile view at `/mobile/`.

No test framework is configured. TypeScript strict mode is the primary correctness check.

## Environment

Requires `SCHWAB_CLIENT_ID` and `SCHWAB_CLIENT_SECRET` in `.env` (see `.env.example`). Optional: `PORT` (default 3000), `HOST` (default 127.0.0.1).

## File Structure

```
src/
├── server.ts              # Express setup, static serving, route registration, HTTPS bootstrap
├── certs.ts               # Self-signed TLS certificate generation
├── schwab.ts              # Schwab OAuth, token persistence/refresh (6-day keep-alive), API fetch functions
├── gex.ts                 # Pure functions: calculateGEX(), getExpirationDates()
├── routes/
│   ├── auth.ts            # /auth/login, /auth/callback, /auth/status
│   ├── stream.ts          # GET /api/stream/:symbol (SSE, unified price + GEX + quote + expirations)
│   └── watchlist.ts       # GET/PUT /api/watchlist, POST/DELETE /api/watchlist/:section/:symbol
└── public/
    ├── index.html         # Desktop HTML shell
    ├── css/styles.css     # Desktop styles
    └── js/
        ├── main.js            # Desktop entry point: app state, event wiring
        ├── api.js             # Shared data layer: openStream() via EventSource, checkAuth()
        ├── layout.js          # LayoutManager: section containers, flex-based resizable widths
        ├── resize.js          # Watchlist sidebar drag-to-resize
        ├── expDialog.js       # Expiration filter dialog
        ├── watchlist.js       # Desktop watchlist sidebar (sections, SSE quotes, drag-to-reorder, context menu)
        └── chart/
            ├── constants.js       # COLORS, LAYOUT, FREQ_MAP, RANGE_MAP
            ├── EventBus.js        # Pub/sub event bus
            ├── ViewportModel.js   # Shared data model: price/GEX data, viewport state, hot/cold buffering
            ├── BaseSection.js     # Base class for Three.js chart sections
            ├── PriceChart.js      # Candlestick chart: candles, grid, dealer levels, pointer events interaction
            ├── GEXSection.js      # GEX bars: call/put bars, cumulative line, GEX/OI toggle
            └── VolumeSection.js   # Volume bars with alert dots
    └── mobile/
        ├── index.html         # Mobile PWA shell: tab layout, meta tags, service worker
        ├── mobile.css         # TradingView dark theme (#000 bg, #2962ff accent)
        ├── mobile.js          # App shell: tabs, watchlist, chart init, picker wheels, bottom sheet
        ├── touch.js           # Swipe-to-delete, long-press drag-to-reorder
        ├── manifest.json      # PWA manifest (standalone, black theme)
        └── sw.js              # Service worker: shell caching, network-first for API
```

The frontend uses native ES modules (no build step). Three.js loaded via CDN import map.

## Architecture

### Backend

- **Auth**: `@sudowealth/schwab-api` for OAuth2. Tokens in `.tokens.json`. `getValidAccessToken()` must be used everywhere (workaround for library bug). Refresh token kept alive via 6-day interval + immediate refresh on startup.
- **SSE streaming** (`/api/stream/:symbol`): `types` param controls data. GEX streamed progressively in 7-day windows via `Promise.race`. Per-type `done` events enable targeted client renders. Quote includes `description` field for company name.
- **Watchlist**: REST CRUD persisted to `watchlist.json`. PUT replaces all sections (used for reorder/move/delete).

### Desktop Frontend

- Modular chart split into `PriceChart`, `GEXSection`, `VolumeSection` — each with own Three.js canvas/scene/camera, sharing `ViewportModel` via `EventBus`.
- `PriceChart` uses Pointer Events (not mouse) — enables touch on mobile while desktop works identically.
- Hot/cold GEX double-buffering prevents partial renders during streaming.
- On-demand rendering (no animation loop) — sections rebuild only on `viewport:change`.
- Desktop watchlist: right sidebar with SSE quotes, HTML5 drag-to-reorder, context menu.

### Mobile Frontend (`/mobile/`)

- Separate PWA entry point sharing chart modules (`PriceChart`, `GEXSection`, `VolumeSection`, `ViewportModel`, `EventBus`, `api.js`).
- Two tabs: Watchlist (two-line rows: ticker+price / name+change%, 30s quote polling) and Chart (full-width candles, GEX/Volume panel via view selector).
- GEX/Volume panel: 70/30 split when active. Section created on demand via `setView()` after layout reflow. Canvas uses `position: absolute` + `width/height: 100% !important` to prevent flex sizing feedback loops.
- Bottom toolbar: native `<select>` dropdowns for symbol, frequency, range, and view mode (Chart Only / Chart + GEX / Chart + Volume). Horizontally scrollable. Expiration multi-select with All/Clear buttons shown only in GEX/Volume modes.
- Watchlist: swipe left to reveal delete button, long-press to drag-reorder. + button is a native `<select>` that opens a dark `<dialog>` for input.
- `user-select: none` + `-webkit-touch-callout: none` globally to suppress native selection on long-press.

## Key Patterns

- **GEX is additive** — chunks stream independently, accumulate in cold buffer, promote to hot on `commitGEX()`.
- **All date logic uses `estToday()`** (US Eastern) to match options market conventions.
- **Pointer Events gesture state machine** in PriceChart: 1 pointer + move = pan, 2 pointers = pinch zoom, long-press 500ms = crosshair, double-tap 300ms = reset, wheel = desktop zoom.
- **Refresh token keep-alive**: forced refresh on startup (5s) + every 6 days prevents 7-day expiry during idle.
- **CSS.escape** in all `querySelector` calls with dynamic symbol/section names.
- **No frontend build step**: native ES modules, Three.js via CDN import map.

## Common Modification Patterns

**Adding a new API endpoint**: Add handler in `src/routes/stream.ts` (new `types` value) or create new route file. Use `getValidAccessToken()`. Register in `server.ts`.

**Adding a new chart section**: Extend `BaseSection`, subscribe to `viewport:change`, add container in `LayoutManager.init()`.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`.

**Adjusting date windows/expiration filter**: Change `intervalDays` (default 7) in `buildDateWindows()` or `60` days in `streamGEX()`.

**Adding chart rendering**: Add to relevant section's `rebuild()`. Use `makePlane()`, `makeLine()`, `batchPlanes()` from BaseSection.

**Mobile changes**: Edit files in `src/public/mobile/`. Chart rendering is shared — mobile-specific behavior lives in `mobile.js` and `touch.js`. Mobile canvas containers use `position: absolute` + `!important` sizing to avoid flex feedback loops. Update `sw.js` SHELL_ASSETS if adding new files.

See [README.md](../README.md) for user-facing documentation, API endpoints, and chart interactions.
