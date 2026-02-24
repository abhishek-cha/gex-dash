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
│   ├── price.ts           # GET /api/price/:symbol
│   └── gex.ts             # GET /api/gex/:symbol (streaming + filtered modes)
└── public/
    ├── index.html         # HTML shell (no embedded CSS or JS)
    ├── css/
    │   └── styles.css     # All CSS styles
    └── js/
        ├── main.js        # Entry point: init(), app state, event wiring
        ├── api.js         # API fetch functions, NDJSON stream reader
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

**GEX endpoint** (`src/routes/gex.ts` - `GET /api/gex/:symbol`):
- Two modes:
  1. **Streaming (default, no `?expirations=`)**: NDJSON (`application/x-ndjson`). First window (0-3mo) is awaited and sent first with GEX levels (60-day default filter). Remaining windows stream expiration date updates via `Promise.race`. Final line: `{ done: true }`.
  2. **Non-streaming (`?expirations=date1,date2,...`)**: Standard JSON. Fetches all windows, merges, calculates GEX with the provided filter.

**Price endpoint** (`src/routes/price.ts` - `GET /api/price/:symbol`):
- Proxies Schwab's `/pricehistory` endpoint. Params: `frequencyType`, `frequency`, `periodType`, `period`.

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

**API layer** (`src/public/js/api.js`):
- `loadGEX(symbol, chart, state, { useFilter })`: if `useFilter`, does standard `fetch` + `res.json()`. Otherwise reads NDJSON stream via `response.body.getReader()`, renders chart on first chunk, updates expirations on subsequent chunks.
- `loadPrice(symbol, chart)`: fetches price history, renders candles.
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
- **Streaming pattern**: the NDJSON streaming in `src/routes/gex.ts` uses `res.write()` + `res.end()` with `Promise.race` for out-of-order window resolution.
- **Expiration filter default**: both server (`src/routes/gex.ts`) and client (`src/public/js/main.js`) independently compute a 60-day cutoff for the default expiration selection, keeping them in sync.
- **Token persistence**: tokens are saved to `.tokens.json` and reloaded on restart so the user doesn't need to re-authenticate.
- **Self-signed TLS**: `ensureCerts()` in `src/certs.ts` generates certs on first run if missing. Required because Schwab OAuth mandates HTTPS callback URLs.

## Common Modification Patterns

**Adding a new API endpoint**: Create a new route file in `src/routes/` or add to an existing one. Use the `getSchwabAuth()` pattern to get the auth instance. Register the route in `src/server.ts`.

**Changing the chart layout**: Modify `LAYOUT` constants in `src/public/js/chart/constants.js` and `_sectionBounds()` in `GEXChart.js`.

**Adding new UI controls**: Add HTML elements inside `<div id="header">` in `index.html`, style them in `css/styles.css`, and wire event listeners in `main.js`'s `init()` function.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`. The function receives the raw Schwab option chain object.

**Adjusting the date window size or cap**: Change the `3` (months) in `buildDateWindows()` or the `2` (years) cap in `src/schwab.ts`.

**Adjusting the default expiration filter**: Change the `60` (days) in both `src/routes/gex.ts` and `src/public/js/main.js`'s `updateExpirationsFromData()`.

**Adding chart rendering features**: Add render functions in `src/public/js/chart/renderers.js` and call them from `rebuild()` in `GEXChart.js`.
