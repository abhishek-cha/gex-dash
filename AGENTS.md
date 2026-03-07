# GEX Dash - Agent Guide

## Project Overview

GEX Dash is a single-page web app that visualizes Gamma Exposure (GEX) for equities and index options using the Schwab API. It has an Express/TypeScript backend and a vanilla JS + Three.js frontend.

## File Structure

```
src/
├── server.ts              # Express setup, JSON body parsing, static serving, route registration, HTTPS bootstrap
├── certs.ts               # Self-signed TLS certificate generation
├── schwab.ts              # Schwab OAuth setup, token persistence, all Schwab API fetch functions
│                          #   (quote, price history, option chains), date windowing, option chain merging
├── gex.ts                 # Pure functions: calculateGEX(), getExpirationDates()
├── routes/
│   ├── auth.ts            # /auth/login, /auth/callback, /auth/status
│   ├── stream.ts          # GET /api/stream/:symbol (SSE, unified price + GEX)
│   └── watchlist.ts       # GET/PUT /api/watchlist, POST/DELETE /api/watchlist/:section/:symbol
└── public/
    ├── index.html         # HTML shell (no embedded CSS or JS)
    ├── css/
    │   └── styles.css     # All CSS styles
    └── js/
        ├── main.js        # Entry point: init(), app state, event wiring
        ├── api.js         # API functions: openStream() via EventSource, checkAuth()
        ├── resize.js          # Watchlist sidebar drag-to-resize logic
        ├── expDialog.js       # Expiration filter dialog logic
        ├── watchlist.js       # Watchlist sidebar (sections, SSE quotes, drag-to-reorder, context menu)
        └── chart/
            ├── constants.js   # COLORS, LAYOUT, FREQ_MAP, RANGE_MAP
            ├── GEXChart.js    # Core chart class: scene, camera, coordinate transforms, rebuild
            ├── renderers.js   # Candle, GEX bar, volume bar, grid, separator, price line rendering
            ├── interaction.js # Mouse drag, zoom, wheel, crosshair, tooltip, bar highlight
            └── labels.js      # DOM label overlay (price axis, dates, GEX/volume scales)
```

The frontend uses native ES modules (no build step or bundler). Three.js is loaded via CDN import map.

## Key Concepts

### GEX Calculation (`src/gex.ts`)

- `GEXLevel` interface: `{ strike, callGex, putGex, netGex, totalVolume, totalOI }`
- `getExpirationDates(optionChain)`: extracts sorted unique expiration date strings from Schwab's `callExpDateMap`/`putExpDateMap` keys (format: `"YYYY-MM-DD:DTE"`, returns just the date portion)
- `calculateGEX(optionChain, selectedExpirations?)`: iterates all contracts, filters by expiration if provided, aggregates GEX per strike. Formula: `|gamma| * OI * 100 * spotPrice` (negative for puts). Also aggregates `totalVolume` and `totalOI` per strike.

### Server

**Auth flow** (`src/schwab.ts` + `src/routes/auth.ts`):
- Uses `@sudowealth/schwab-api` for OAuth2.
- Tokens stored in `.tokens.json` at project root (gitignored).
- `/auth/login` -> Schwab OAuth -> `/auth/callback` -> exchanges code -> redirects to `/`.

**Option chain fetching** (`src/schwab.ts`):
- `estToday()`: returns today's date in US Eastern Time (America/New_York) as a midnight-UTC `Date`. Used for all date windowing and caps to ensure consistency regardless of server timezone.
- `buildDateWindows(intervalDays=7)`: generates rolling date windows spanning 2 years from today (ET). Default is 7-day intervals.
- `fetchOptionChainWindow()`: fetches a single window from Schwab's `/chains` endpoint.
- `fetchExpirations()`: lightweight call to Schwab's `/expirationchain` endpoint — returns only expiration dates (no strikes/greeks/contracts), capped to 2 years from today (ET).

**Watchlist** (`src/routes/watchlist.ts`):
- REST API for managing watchlist sections. Data model: `{ name: string, symbols: string[] }[]`.
- `GET /api/watchlist`: returns the sections array. Auto-migrates legacy flat `string[]` format on first read.
- `PUT /api/watchlist`: replaces all sections (used by frontend for reorder/move/delete operations).
- `POST /api/watchlist/:section/:symbol`: adds a symbol to a named section (uppercased, deduplicated).
- `DELETE /api/watchlist/:section/:symbol`: removes a symbol from a section.
- Persisted to `watchlist.json` at project root (gitignored).
- `express.json()` middleware is registered in `server.ts` for the PUT body parsing.

**Stream endpoint** (`src/routes/stream.ts` - `GET /api/stream/:symbol`):
- Unified SSE endpoint. The `types` query param (comma-separated) controls what data is fetched:
  - `price`: fetches Schwab `/pricehistory`, sends `event: price`, then `event: done { type: "price" }`.
  - `quote`: fetches Schwab `/quotes` endpoint, sends `event: quote` with `{ price, change, percentChange }`, then `event: done { type: "quote" }`.
  - `gex`: **progressive streaming** — only fetches the 7-day windows that overlap with needed dates (60-day default or explicit filter), sends per-chunk `event: gex` (with `gexLevels` + `selectedExpirations`) as each window resolves via `Promise.race`. Ends with `event: done { type: "gex" }`. GEX is summable per strike so each chunk is independent.
  - `expiration`: single lightweight call to Schwab's `/expirationchain` endpoint (no option chain fetching). Returns all available expiration dates (capped to 2 years) in one `event: expirations`. Ends with `event: done { type: "expiration" }`.
- Per-type `done` events (`done: { type: "price" | "quote" | "gex" | "expiration" }`) fire as each type completes. A final `done: {}` (no type) signals all types are finished.
- **Window optimization**: `gex` type filters `buildDateWindows()` to only fetch windows overlapping with the needed date range. For default 60-day, ~3 windows. For explicit filter, only windows containing selected dates (e.g. one date 1.5yr out = 1 window, not 26).
- Default expiration filter: 60-day cutoff applied per chunk. If `expirations` query param is provided, that explicit filter is used instead.
- Usage scenarios:
  - Initial symbol load: `?types=price,gex,quote,expiration`
  - Freq/range change: `?types=price`
  - Expiration filter apply: `?types=gex,quote&expirations=date1,date2,...`

### Frontend

**`GEXChart` class** (`src/public/js/chart/GEXChart.js`):
- Orthographic camera, 4-section layout: candle chart, price axis, call/put GEX bars, volume bars.
- **Data setters never trigger renders.** All rendering is driven by explicit rebuild calls.
- Key data methods: `loadPriceData()`, `setSpotPrice()`, `clearGEX()`, `clearPrice()`, `mergeGEXChunk(gexData)`, `commitGEX()`.
- **Hot/cold GEX double-buffering**: `mergeGEXChunk(gexData)` accumulates into a cold buffer (`_coldGexLevels`) by summing `callGex`, `putGex`, `netGex`, `totalVolume`, `totalOI` per strike. `commitGEX()` promotes cold to hot (`gexLevels`). Only hot is painted by renderers. This prevents pan/zoom during streaming from painting incomplete GEX. `clearGEX()` clears both buffers.
- Key render methods: `rebuildPrice()` (grid + candles + overlays), `rebuildGEX()` (GEX bars + volume bars + dealer levels), `rebuild()` (full rebuild, calls both).
- `highlightStrike()` / `clearHighlight()` manage a dedicated Three.js group that renders semi-transparent glow planes behind the hovered strike's GEX and volume bars.
- Uses `ResizeObserver` on the container element (not `window.resize`) so the chart resizes correctly when the watchlist sidebar toggles.
- Rendering delegated to `renderers.js`, interaction to `interaction.js`, labels to `labels.js`.

**Chart interactions** (`src/public/js/chart/interaction.js`):
- `_chartDrag`: click+drag on candle area to pan horizontally (Y auto-fits).
- `_axisDrag`: click+drag on price axis to zoom Y scale, anchored to click point.
- `_xAxisDrag`: click+drag on date labels area to zoom X scale, anchored to click point.
- Double-click on candle area or price axis to reset to auto-fit.
- `_manualYScale` flag prevents auto-fit from overriding user's Y zoom.
- Tooltip is shown anchored to the GEX section based on crosshair Y position (nearest strike). Shows call/put/net GEX, volume, and OI. No tooltip on the candle area itself.
- Crosshair triggers `highlightStrike()` / `clearHighlight()` for glow effect on hovered bars. Colors use `COLORS` constants via a `hexCss()` helper (no hardcoded hex strings).

**Watchlist sidebar** (`src/public/js/watchlist.js`):
- Persistent right sidebar panel (TradingView-style), open by default. Toggle via Watchlist button in header.
- **Sections**: symbols organized into named collapsible sections. Data model mirrors backend: `[{ name, symbols }]`.
- **SSE quote fetching**: opens one `EventSource` per symbol via `/api/stream/:symbol?types=quote` (independent of the main chart stream — avoids `_activeStreamId` conflicts in `api.js`). Streams are opened on `openWatchlist()` and closed on `closeWatchlist()`.
- **Targeted DOM mutations**: after initial `render()` on open, all add/remove/move/reorder operations mutate the DOM directly (appendChild, before/after, remove) without re-rendering. Quote data lives in the DOM elements — no cache needed. `saveWatchlist()` is fire-and-forget (PUT, no await).
- **Drag-to-reorder**: HTML5 native drag-and-drop. Rows can be reordered within or moved across sections. Drop position determined by cursor position relative to target row midpoint.
- **Context menu**: right-click a row to move it to an existing section, create a new section, or remove it. Menu positioned with viewport clamping.
- **Circular + button**: `#wl-add-btn` in the header, visible only when `activeSymbol` is not in any section. Adds to the first section (creates "Watchlist" default section if none exist).
- **Resizable width**: a drag handle (`#wl-resize-handle`) between `#chart-wrap` and `#watchlist-panel` allows resizing (180–340px). Below 280px the panel gets a `.compact` class that hides Change and Change% columns via CSS.
- **Quote sync from chart stream**: when the main chart stream's quote arrives, `api.js` calls `updateWatchlistQuote(sym, data)` to push the fresher quote into the watchlist row (if it exists), keeping it in sync without waiting for the independent per-symbol SSE stream.
- **Toggle indicator**: Watchlist button gets `.active` class when panel is open.
- Exports: `openWatchlist(selectCb)`, `closeWatchlist()`, `setActiveSymbol(sym)`, `updateWatchlistQuote(sym, quoteData)`.

**App state** (`src/public/js/main.js`):
- `state.currentSymbol`: currently loaded ticker.
- `state.allExpirations`: all available expiration dates (grows as stream delivers).
- `state.selectedExpirations`: Set of currently selected dates for GEX filter.
- `state.activeStream`: current `EventSource` instance (closed before opening a new one).

**API layer** (`src/public/js/api.js`):
- `openStream(symbol, { types, chart, state, expirations? })`: opens an `EventSource` to `/api/stream/:symbol` with the specified `types`. Uses epoch-based stale detection (`_activeStreamId`) to discard events from superseded streams. Clears GEX data when a new stream requests GEX. Attaches typed event listeners:
  - `price` / `quote`: buffer data silently (no render).
  - `gex`: calls `chart.mergeGEXChunk()` to accumulate into cold buffer. Unions `selectedExpirations` into state.
  - `expirations`: updates `state.allExpirations`.
  - `done { type: "price" }`: if GEX is also streaming, `rebuildPrice()` only (avoids partial GEX render); otherwise `rebuild()` to reposition existing GEX bars on the new price scale.
  - `done { type: "quote" }`: `applyQuote()` updates header + `setSpotPrice()`, `updateWatchlistQuote()` syncs the watchlist row, then `buildPriceLine()` draws the spot line.
  - `done { type: "gex" }`: `commitGEX()` promotes cold to hot, then `rebuildGEX()`.
  - `done {}` (no type): final signal, closes the EventSource.
  - `error`: hides loading indicators, closes stream.
- `applyQuote(quoteData, chart)`: updates the header price/change display and calls `chart.setSpotPrice()`.
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
- **SSE streaming with progressive GEX**: `src/routes/stream.ts` uses Server-Sent Events (`text/event-stream`) with typed events (`price`, `quote`, `gex`, `expirations`, `done`, `error`). GEX is streamed progressively — option chains are fetched in 14-day windows, and each chunk's GEX is sent as it resolves. The client accumulates GEX per strike (GEX is summable: `|gamma| * OI * 100 * spot`). Per-type `done` events (`done: { type }`) signal when each data type is complete, enabling targeted renders. The final `done: {}` (no type) closes the stream.
- **Separation of data and rendering**: `GEXChart` data setters (`loadPriceData`, `setSpotPrice`, `mergeGEXChunk`, `clearGEX`) never trigger renders. Only `done` event handlers call `rebuildPrice()` or `rebuildGEX()`. GEX uses hot/cold double-buffering: chunks accumulate in cold (`_coldGexLevels`), `commitGEX()` promotes to hot (`gexLevels`) before painting. This prevents pan/zoom during streaming from rendering incomplete GEX.
- **Expiration filter default**: the server computes a 60-day cutoff per chunk and returns `selectedExpirations` in each `gex` event payload. The client unions these additively — no duplicated logic.
- **Token persistence**: tokens are saved to `.tokens.json` and reloaded on restart so the user doesn't need to re-authenticate.
- **Self-signed TLS**: `ensureCerts()` in `src/certs.ts` generates certs on first run if missing. Required because Schwab OAuth mandates HTTPS callback URLs.
- **Watchlist persistence**: sections are stored in `watchlist.json` (gitignored) as `[{ name, symbols }]` via REST endpoints in `src/routes/watchlist.ts`. The frontend sidebar (`watchlist.js`) uses targeted DOM mutations — no full re-renders after initial open. Per-symbol SSE quote streams are independent of the main chart stream. The main chart quote also syncs to the watchlist row via `updateWatchlistQuote()`.
- **Watchlist resize**: `resize.js` adds drag-to-resize on the `#wl-resize-handle` element between chart and sidebar (180–340px range). A `ResizeObserver` on the panel toggles a `.compact` CSS class below 280px, hiding the Change/Change% columns.
- **ResizeObserver for chart**: `GEXChart` uses `new ResizeObserver().observe(container)` instead of `window.resize` so the chart properly resizes when the watchlist sidebar is toggled or resized (sidebar changes container width but doesn't fire `window.resize`).

## Common Modification Patterns

**Adding a new API endpoint**: For new data types, add a handler in `src/routes/stream.ts` and register a new `types` value. For non-streaming endpoints, create a new route file in `src/routes/`. Use the `getSchwabAuth()` pattern to get the auth instance. Register the route in `src/server.ts`.

**Changing the chart layout**: Modify `LAYOUT` constants (e.g. `gexSectionRatio`, `volumeSectionRatio`) in `src/public/js/chart/constants.js` and `_sectionBounds()` in `GEXChart.js`.

**Adding new UI controls**: Add HTML elements inside `<div id="header">` in `index.html`, style them in `css/styles.css`, and wire event listeners in `main.js`'s `init()` function.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`. The function receives the raw Schwab option chain object.

**Adjusting the date window size or cap**: Change the `intervalDays` default (currently `7`) in `buildDateWindows()` or the `2` (years) cap in `src/schwab.ts`. All date logic uses `estToday()` (US Eastern Time) to match options market conventions.

**Adjusting the default expiration filter**: Change the `60` (days) in `src/routes/stream.ts`'s `streamGEX()`. The client receives `selectedExpirations` from the server and applies it directly.

**Adding chart rendering features**: Add render functions in `src/public/js/chart/renderers.js` and call them from the appropriate rebuild method (`rebuildPrice()`, `rebuildGEX()`, or `rebuild()`) in `GEXChart.js`.

**Volume alert dot**: In `renderers.js`, `buildVolumeBars()` renders a small orange circle (`COLORS.volumeAlert`) beside volume bars where `totalVolume > totalOI` (both must be > 0). This signals unusual activity at that strike.

**Dealer support/resistance lines**: `buildDealerLevels()` in `renderers.js` draws two dotted horizontal lines across the candle chart area: a red line (`COLORS.dealerResistance`) at the strike above spot with the highest positive net GEX (resistance), and a green line (`COLORS.dealerSupport`) at the strike below spot with the most negative net GEX (support). Uses a dedicated `dealerLevels` Three.js group, cleared in `rebuildGEX()` and `rebuild()`.
