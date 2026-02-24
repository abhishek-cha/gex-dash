# GEX Dash - Agent Guide

## Project Overview

GEX Dash is a single-page web app that visualizes Gamma Exposure (GEX) for equities and index options using the Schwab API. It has an Express/TypeScript backend and a vanilla JS + Three.js frontend.

## File Structure

```
src/
├── server.ts              # Express setup, static serving, route registration, HTTPS bootstrap
├── certs.ts               # Self-signed TLS certificate generation
├── schwab.ts              # Schwab OAuth setup, token persistence, all Schwab API fetch functions,
│                          #   date windowing, option chain merging
├── gex.ts                 # Pure functions: calculateGEX(), getExpirationDates()
├── routes/
│   ├── auth.ts            # /auth/login, /auth/callback, /auth/status
│   └── stream.ts          # GET /api/stream/:symbol (SSE, unified price + GEX)
└── public/
    ├── index.html         # HTML shell (no embedded CSS or JS)
    ├── css/
    │   └── styles.css     # All CSS styles
    └── js/
        ├── main.js        # Entry point: init(), app state, event wiring
        ├── api.js         # API functions: openStream() via EventSource, checkAuth()
        ├── expDialog.js   # Expiration filter dialog logic
        └── chart/
            ├── constants.js   # COLORS, LAYOUT, FREQ_MAP, RANGE_MAP
            ├── GEXChart.js    # Core chart class: scene, camera, coordinate transforms, rebuild
            ├── renderers.js   # Candle, GEX bar, grid, separator, price line rendering
            ├── interaction.js # Mouse drag, zoom, wheel, crosshair, tooltip handlers
            └── labels.js      # DOM label overlay (price axis, dates, GEX scales)
```

The frontend uses native ES modules (no build step or bundler). Three.js is loaded via CDN import map.

## Key Concepts

### GEX Calculation (`src/gex.ts`)

- `GEXLevel` interface: `{ strike, callGex, putGex, netGex }`
- `getExpirationDates(optionChain)`: extracts sorted unique expiration date strings from Schwab's `callExpDateMap`/`putExpDateMap` keys (format: `"YYYY-MM-DD:DTE"`, returns just the date portion)
- `calculateGEX(optionChain, selectedExpirations?)`: iterates all contracts, filters by expiration if provided, aggregates GEX per strike. Formula: `|gamma| * OI * 100 * spotPrice` (negative for puts)

### Server

**Auth flow** (`src/schwab.ts` + `src/routes/auth.ts`):
- Uses `@sudowealth/schwab-api` for OAuth2.
- Tokens stored in `.tokens.json` at project root (gitignored).
- `/auth/login` -> Schwab OAuth -> `/auth/callback` -> exchanges code -> redirects to `/`.

**Option chain fetching** (`src/schwab.ts`):
- `buildDateWindows()`: generates 3-month date windows spanning 2 years from today.
- `fetchOptionChainWindow()`: fetches a single window from Schwab's `/chains` endpoint.
- `fetchOptionChainAll()`: parallel fetch + merge of all windows (used for the filtered/non-streaming path).

**Stream endpoint** (`src/routes/stream.ts` - `GET /api/stream/:symbol`):
- Unified SSE endpoint. The `types` query param (comma-separated) controls what data is fetched:
  - `price`: fetches Schwab `/pricehistory`, sends `event: price`. Accepts `frequencyType`, `frequency`, `periodType`, `period` query params.
  - `gex`: fetches option chain windows, sends `event: gex` (first window, 60-day default filter) then `event: expirations` (subsequent windows). If `expirations` query param is provided, fetches all windows, merges, calculates GEX with the filter, sends a single `event: gex`.
- All requests end with `event: done`. Price and GEX fetches run concurrently when both types are requested.
- Usage scenarios:
  - Initial symbol load: `?types=price,gex`
  - Freq/range change: `?types=price`
  - Expiration filter apply: `?types=gex&expirations=date1,date2,...`

### Frontend

**`GEXChart` class** (`src/public/js/chart/GEXChart.js`):
- Orthographic camera, 4-section layout: candle chart, price axis, call/put GEX bars, net GEX bars.
- Key methods: `loadPriceData()`, `loadGEXData()`, `clearGEX()`, `rebuild()`.
- Rendering delegated to `renderers.js`, interaction to `interaction.js`, labels to `labels.js`.

**Chart interactions** (`src/public/js/chart/interaction.js`):
- `_chartDrag`: click+drag on candle area to pan horizontally (Y auto-fits).
- `_axisDrag`: click+drag on price axis to zoom Y scale, anchored to click point.
- `_xAxisDrag`: click+drag on date labels area to zoom X scale, anchored to click point.
- Double-click on candle area or price axis to reset to auto-fit.
- `_manualYScale` flag prevents auto-fit from overriding user's Y zoom.

**App state** (`src/public/js/main.js`):
- `state.currentSymbol`: currently loaded ticker.
- `state.allExpirations`: all available expiration dates (grows as stream delivers).
- `state.selectedExpirations`: Set of currently selected dates for GEX filter.
- `state.activeStream`: current `EventSource` instance (closed before opening a new one).

**API layer** (`src/public/js/api.js`):
- `openStream(symbol, { types, chart, state, expirations? })`: opens an `EventSource` to `/api/stream/:symbol` with the specified `types`. Attaches typed event listeners (`price`, `gex`, `expirations`, `done`, `error`). Returns the `EventSource` so the caller can close it on abort.
- `checkAuth()`: checks `/auth/status`.

## Development Commands

```bash
npm run dev      # tsx watch src/server.ts (auto-reload)
npm run build    # tsc + copy public/ to dist/
npm start        # node dist/server.js
```

Server runs at `https://127.0.0.1:3000` (HTTPS required for Schwab OAuth). Self-signed certs auto-generated in `certs/`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SCHWAB_CLIENT_ID` | Yes | Schwab Developer app key |
| `SCHWAB_CLIENT_SECRET` | Yes | Schwab Developer app secret |
| `PORT` | No | Server port (default: 3000) |

## Important Patterns

- **No frontend build step**: frontend uses native ES module `.js` files. Three.js is loaded via CDN import map in `index.html`.
- **SSE streaming**: `src/routes/stream.ts` uses Server-Sent Events (`text/event-stream`) with typed events (`price`, `gex`, `expirations`, `done`, `error`). The client uses native `EventSource` API. The `types` query param controls which data types are fetched and streamed. Price and GEX fetches run concurrently when both are requested.
- **Expiration filter default**: the server (`src/routes/stream.ts`) computes the 60-day cutoff for the default expiration selection and returns `selectedExpirations` in the `gex` event payload. The client sets its state directly from the server response — no duplicated logic.
- **Token persistence**: tokens are saved to `.tokens.json` and reloaded on restart so the user doesn't need to re-authenticate.
- **Self-signed TLS**: `ensureCerts()` in `src/certs.ts` generates certs on first run if missing. Required because Schwab OAuth mandates HTTPS callback URLs.

## Common Modification Patterns

**Adding a new API endpoint**: For new data types, add a handler in `src/routes/stream.ts` and register a new `types` value. For non-streaming endpoints, create a new route file in `src/routes/`. Use the `getSchwabAuth()` pattern to get the auth instance. Register the route in `src/server.ts`.

**Changing the chart layout**: Modify `LAYOUT` constants in `src/public/js/chart/constants.js` and `_sectionBounds()` in `GEXChart.js`.

**Adding new UI controls**: Add HTML elements inside `<div id="header">` in `index.html`, style them in `css/styles.css`, and wire event listeners in `main.js`'s `init()` function.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`. The function receives the raw Schwab option chain object.

**Adjusting the date window size or cap**: Change the `3` (months) in `buildDateWindows()` or the `2` (years) cap in `src/schwab.ts`.

**Adjusting the default expiration filter**: Change the `60` (days) in `src/routes/stream.ts`'s `streamGEX()`. The client receives `selectedExpirations` from the server and applies it directly.

**Adding chart rendering features**: Add render functions in `src/public/js/chart/renderers.js` and call them from `rebuild()` in `GEXChart.js`.
