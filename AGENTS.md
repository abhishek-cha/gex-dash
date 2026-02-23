# GEX Dash - Agent Guide

## Project Overview

GEX Dash is a single-page web app that visualizes Gamma Exposure (GEX) for equities and index options using the Schwab API. It has an Express/TypeScript backend and a vanilla JS + Three.js frontend.

## File Structure

```
src/
├── server.ts          # Express HTTPS server, all API routes, Schwab OAuth, streaming GEX endpoint
├── gex.ts             # Pure functions: calculateGEX(), getExpirationDates()
└── public/
    └── index.html     # Entire frontend: CSS, HTML, Three.js chart renderer, all client JS
```

There are only **3 source files**. The frontend is a single HTML file with embedded `<style>` and `<script type="module">` blocks -- there is no build step or bundler for the frontend.

## Key Concepts

### GEX Calculation (`src/gex.ts`)

- `GEXLevel` interface: `{ strike, callGex, putGex, netGex }`
- `getExpirationDates(optionChain)`: extracts sorted unique expiration date strings from Schwab's `callExpDateMap`/`putExpDateMap` keys (format: `"YYYY-MM-DD:DTE"`, returns just the date portion)
- `calculateGEX(optionChain, selectedExpirations?)`: iterates all contracts, filters by expiration if provided, aggregates GEX per strike. Formula: `|gamma| * OI * 100 * spotPrice` (negative for puts)

### Server (`src/server.ts`)

**Auth flow:**
- Uses `@sudowealth/schwab-api` for OAuth2.
- Tokens stored in `.tokens.json` at project root (gitignored).
- `/auth/login` -> Schwab OAuth -> `/auth/callback` -> exchanges code -> redirects to `/`.

**Option chain fetching:**
- `buildDateWindows()`: generates 3-month date windows spanning 2 years from today.
- `fetchOptionChainWindow()`: fetches a single window from Schwab's `/chains` endpoint.
- `fetchOptionChainAll()`: parallel fetch + merge of all windows (used for the filtered/non-streaming path).

**GEX endpoint (`GET /api/gex/:symbol`):**
- Two modes:
  1. **Streaming (default, no `?expirations=`)**: NDJSON (`application/x-ndjson`). First window (0-3mo) is awaited and sent first with GEX levels (60-day default filter). Remaining windows stream expiration date updates via `Promise.race`. Final line: `{ done: true }`.
  2. **Non-streaming (`?expirations=date1,date2,...`)**: Standard JSON. Fetches all windows, merges, calculates GEX with the provided filter.

**Price endpoint (`GET /api/price/:symbol`):**
- Proxies Schwab's `/pricehistory` endpoint. Params: `frequencyType`, `frequency`, `periodType`, `period`.

### Frontend (`src/public/index.html`)

**`GEXChart` class** (Three.js):
- Orthographic camera, 4-section layout: candle chart, price axis, call/put GEX bars, net GEX bars.
- Key methods: `loadPriceData()`, `loadGEXData()`, `clearGEX()`, `rebuild()`.
- Crosshair + tooltip on hover.
- Chart interactions managed in `_setupInteraction()`:
  - `_chartDrag`: click+drag on candle area to pan horizontally (Y auto-fits).
  - `_axisDrag`: click+drag on price axis to zoom Y scale, anchored to click point.
  - `_xAxisDrag`: click+drag on date labels area to zoom X scale, anchored to click point.
  - Double-click on candle area or price axis to reset to auto-fit.
  - `_manualYScale` flag prevents auto-fit from overriding user's Y zoom.

**App state variables:**
- `currentSymbol`: currently loaded ticker.
- `allExpirations`: all available expiration dates (grows as stream delivers).
- `selectedExpirations`: Set of currently selected dates for GEX filter.

**Key functions:**
- `loadGEX(symbol, { useFilter })`: if `useFilter`, does standard `fetch` + `res.json()`. Otherwise reads NDJSON stream via `response.body.getReader()`, renders chart on first chunk, updates expirations on subsequent chunks.
- `loadPrice(symbol)`: fetches price history, renders candles.
- `loadSymbol(symbol)`: resets state, fires `loadPrice` and `loadGEX` in parallel.
- `openExpDialog()` / `applyExpFilter()`: manages the expiration filter modal.

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

- **No frontend build step**: all frontend code lives in `index.html`. Three.js is loaded via CDN import map.
- **Streaming pattern**: the NDJSON streaming in the GEX endpoint uses `res.write()` + `res.end()` with `Promise.race` for out-of-order window resolution.
- **Expiration filter default**: both server and client independently compute a 60-day cutoff for the default expiration selection, keeping them in sync.
- **Token persistence**: tokens are saved to `.tokens.json` and reloaded on restart so the user doesn't need to re-authenticate.
- **Self-signed TLS**: `ensureCerts()` generates certs on first run if missing. Required because Schwab OAuth mandates HTTPS callback URLs.

## Common Modification Patterns

**Adding a new API endpoint**: Add the route in `server.ts` after the existing routes. Use `schwabAuth.getAccessToken()` for the bearer token and proxy to `SCHWAB_API_BASE`.

**Changing the chart layout**: Modify `LAYOUT` constants and `_sectionBounds()` in the `GEXChart` class inside `index.html`.

**Adding new UI controls**: Add HTML elements inside `<div id="header">`, style them in the `<style>` block, and wire event listeners in the `init()` function.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`. The function receives the raw Schwab option chain object.

**Adjusting the date window size or cap**: Change the `3` (months) in `buildDateWindows()` or the `2` (years) cap in `server.ts`.

**Adjusting the default expiration filter**: Change the `60` (days) in both the server endpoint and the client's `updateExpirationsFromData()` function.
