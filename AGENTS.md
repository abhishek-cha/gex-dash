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
        ├── main.js            # Entry point: init(), app state, event wiring
        ├── api.js             # API functions: openStream() via EventSource, checkAuth()
        ├── layout.js          # LayoutManager: creates section containers, manages visibility
        ├── resize.js          # Watchlist sidebar drag-to-resize logic
        ├── expDialog.js       # Expiration filter dialog logic
        ├── watchlist.js       # Watchlist sidebar (sections, SSE quotes, drag-to-reorder, context menu)
        └── chart/
            ├── constants.js       # COLORS, LAYOUT, FREQ_MAP, RANGE_MAP
            ├── EventBus.js        # Pub/sub event bus for decoupled communication
            ├── ViewportModel.js   # Shared data model: price/GEX data, viewport state, transforms
            ├── BaseSection.js     # Base class for chart sections: Three.js scene, camera, resize
            ├── PriceChart.js      # Candlestick chart section: candles, grid, price line, dealer levels, interaction
            ├── GEXSection.js      # GEX bars section: call/put bars, cumulative line, highlight, tooltip
            └── VolumeSection.js   # Volume bars section: volume bars, alert dots, highlight
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
- **Window optimization**: `gex` type filters `buildDateWindows()` to only fetch windows overlapping with the needed date range. For default 60-day, ~9 windows. For explicit filter, only windows containing selected dates (e.g. one date 1.5yr out = 1 window, not 26).
- Default expiration filter: 60-day cutoff applied per chunk. If `expirations` query param is provided, that explicit filter is used instead.
- Usage scenarios:
  - Initial symbol load: `?types=price,gex,quote,expiration`
  - Freq/range change: `?types=price`
  - Expiration filter apply: `?types=gex,quote&expirations=date1,date2,...`

### Frontend

**Modular chart architecture**: The chart is split into independent sections, each with its own Three.js canvas, scene, and camera. All sections share a `ViewportModel` for data and viewport state, coordinated via an `EventBus`.

**`EventBus`** (`src/public/js/chart/EventBus.js`):
- Simple pub/sub: `on(event, fn)`, `off(event, fn)`, `emit(event, data)`.
- Singleton `bus` export used by all components.
- Key events: `viewport:change` (triggers section rebuilds), `interaction:crosshair` (syncs hover across all sections — any section can emit, all sections subscribe).

**`ViewportModel`** (`src/public/js/chart/ViewportModel.js`):
- Shared data model owned by `LayoutManager`, passed to all sections.
- Holds: `priceData`, `gexLevels` (hot), `_coldGexLevels` (cold buffer), `spotPrice`, `viewPriceMin/Max`, `viewStartIdx/EndIdx`.
- **Derived GEX data**: `sortedStrikes`, `strikeIndex`, `sortedLevels`, `gexMax`, `combinedCumulative`, `cumulativeMap`, `maxCumulativeAbs` — computed once on `commitGEX()` via `_postProcessGEX()`, cleared on `clearGEX()`.
- Data methods: `loadPriceData()`, `mergeGEXChunk()`, `commitGEX()`, `setSpotPrice()`, `clearGEX()`, `clearPrice()`.
- `loadPriceData()` emits `viewport:change` via the bus.
- **Hot/cold GEX double-buffering**: `mergeGEXChunk()` accumulates into cold buffer. `commitGEX()` promotes cold to hot, then runs `_postProcessGEX()` to compute all derived data before any events fire.
- Utility methods: `nearestGexLevel()`, `niceStep()`, `fmtGex()`, `fmtVol()`.

**`BaseSection`** (`src/public/js/chart/BaseSection.js`):
- Base class for all chart sections. Creates a Three.js `WebGLRenderer`, `OrthographicCamera`, `Scene`.
- Manages groups, resize via `ResizeObserver`, on-demand rendering (single `requestAnimationFrame` per `render()` call, coalesced via `_renderScheduled` flag — no continuous animation loop).
- Provides `makePlane()`, `makeLine()`, `batchPlanes()`, `priceToY()`, `yToPrice()` shared by subclasses.
- Shared helpers: `_initHighlightGroup()`, `_clearHighlightGroup()` for hover highlight management (used by GEXSection, VolumeSection). `_gexBarBounds(strike, sortedStrikes, idx)` computes bar Y/height from sorted strike array and pre-computed index.

**`PriceChart`** (`src/public/js/chart/PriceChart.js`):
- Candlestick chart with grid, price axis labels, price line, dealer levels.
- Owns all mouse interaction: pan, Y-axis zoom, X-axis zoom, wheel zoom, crosshair.
- Emits `viewport:change` on pan/zoom (updates ViewportModel directly, then emits).
- Emits `interaction:crosshair` so GEX/Volume sections can show highlights and tooltips.
- Subscribes to `interaction:crosshair` from other sections: shows horizontal crosshair line and price tag, hides vertical crosshair.
- Creates its own DOM overlays: labels, crosshair lines (`crosshair-h`, `crosshair-v`), crosshair price tag.
- Price axis has an opaque background plane (z=0.5) to occlude candles that extend into the axis area during pan.

**`GEXSection`** (`src/public/js/chart/GEXSection.js`):
- Pure renderer — all data computation lives in `ViewportModel._postProcessGEX()`. Reads pre-computed `vp.sortedStrikes`, `vp.strikeIndex`, `vp.sortedLevels`, `vp.gexMax`, `vp.combinedCumulative`, `vp.cumulativeMap`, `vp.maxCumulativeAbs`.
- Call/put GEX bars rendered from center (calls right, puts left).
- **Cumulative net GEX line**: amber line overlaid on the GEX bars showing cumulative net GEX radiating outward from spot price — upward to highest strike, downward to lowest (data computed in ViewportModel).
- Own mouse interaction: mousemove emits `interaction:crosshair` with `{ price, source: 'gex' }`, mouseleave emits `null`.
- Subscribes to `interaction:crosshair` for highlight glow, tooltip display, and horizontal crosshair line.
- Tooltip shows strike, call/put/net GEX, volume, OI, and cumulative GEX.
- Creates its own DOM overlays: labels overlay with GEX scale, horizontal crosshair line (`crosshair-h`).

**`VolumeSection`** (`src/public/js/chart/VolumeSection.js`):
- Per-strike volume bars with orange alert dots when volume > OI.
- Own mouse interaction: mousemove emits `interaction:crosshair` with `{ price, source: 'volume' }`, mouseleave emits `null`.
- Subscribes to `interaction:crosshair` for highlight glow and horizontal crosshair line.
- Creates its own DOM overlays: labels overlay with volume scale, horizontal crosshair line (`crosshair-h`).

**`LayoutManager`** (`src/public/js/layout.js`):
- Creates `ViewportModel` and section containers inside `#chart-wrap`.
- Sections arranged via CSS flexbox: price (flex:1), gex (22%), volume (13%).
- **Resizable section widths**: drag handles (`.section-resize-handle`) between adjacent sections allow horizontal resizing. Drag logic works in proportional flex ratios (`flex: <ratio> 0 0%`) so sections scale naturally when the container resizes (e.g. watchlist toggle). Min-widths enforced: price 200px, gex 120px, volume 80px. Handles auto-hide when an adjacent section is toggled off.
- `toggleSection(key)` shows/hides individual sections.
- `init()` creates all section DOM wrappers, resize handles, and instantiates components.

**Watchlist sidebar** (`src/public/js/watchlist.js`):
- Persistent right sidebar panel (TradingView-style), open by default. Toggle via Watchlist button in header.
- **Sections**: symbols organized into named collapsible sections. Data model mirrors backend: `[{ name, symbols }]`.
- **SSE quote fetching**: opens one `EventSource` per symbol via `/api/stream/:symbol?types=quote` (independent of the main chart stream — avoids `_activeStreamId` conflicts in `api.js`). Streams are opened on `openWatchlist()` and closed on `closeWatchlist()`.
- **Targeted DOM mutations**: after initial `render()` on open, all add/remove/move/reorder operations mutate the DOM directly (appendChild, before/after, remove) without re-rendering. Quote data lives in the DOM elements — no cache needed. `saveWatchlist()` is fire-and-forget (PUT, no await).
- **Drag-to-reorder**: HTML5 native drag-and-drop. Rows can be reordered within or moved across sections. Section headers are also draggable to reorder entire sections. Drop position determined by cursor position relative to target midpoint. Section drag uses separate `sectionDragData` state and guards in row handlers to prevent interference.
- **Context menu**: right-click a row to move it to an existing section, create a new section, or remove it. Menu positioned with viewport clamping.
- **Circular + button**: `#wl-add-btn` in the header, visible only when `activeSymbol` is not in any section. Adds to the first section (creates "Watchlist" default section if none exist).
- **Resizable width**: a drag handle (`#wl-resize-handle`) between `#chart-wrap` and `#watchlist-panel` allows resizing (180–340px). Below 280px the panel gets a `.compact` class that hides Change and Change% columns via CSS.
- **Quote sync from chart stream**: when the main chart stream's quote arrives, `api.js` emits `data:quote` on the bus. `main.js`'s `setupBusSubscriptions()` handles this event and calls `updateWatchlistQuote(sym, data)` to push the fresher quote into the watchlist row (if it exists), keeping it in sync without waiting for the independent per-symbol SSE stream.
- **Toggle indicator**: Watchlist button gets `.active` class when panel is open.
- Exports: `openWatchlist(selectCb)`, `closeWatchlist()`, `setActiveSymbol(sym)`, `updateWatchlistQuote(sym, quoteData)`.

**App state & DOM side-effects** (`src/public/js/main.js`):
- `state.currentSymbol`: currently loaded ticker.
- `state.allExpirations`: all available expiration dates (grows as stream delivers).
- `state.selectedExpirations`: Set of currently selected dates for GEX filter.
- `state.activeStream`: current `EventSource` instance (closed before opening a new one).
- `cacheDOM()`: caches header element refs (`hdrSymbol`, `hdrPrice`, `hdrChange`, `hdrTotalGex`, `hdrTotalGexVal`, `freqSel`, `rangeSel`, etc.).
- `setupBusSubscriptions()`: subscribes to all bus events for DOM side-effects:
  - `stream:start` / `stream:end` / `stream:error`: show/hide loading indicators.
  - `done:price` / `done:gex` / `done:expiration`: hide loading, update filter button badge. `done:gex` also calls `updateTotalGex()`.
  - `data:quote`: updates header price/change display, syncs watchlist row via `updateWatchlistQuote()`.
  - `data:gex-chunk`: unions `selectedExpirations` into `state.selectedExpirations`.
  - `data:expirations`: updates `state.allExpirations`.
- `updateTotalGex()`: sums all `netGex` from `viewport.gexLevels`, updates `#hdr-total-gex-val` with formatted total. The label "Total GEX" is static HTML; JS only sets the value and toggles the `positive`/`negative` class for green/red background (grey default). Reset to `--` on symbol change.
- `currentPriceParams()`: reads freq/range DOM selects and returns params for `openStream()`.
- `loadSymbol()` / `reloadPrice()` / `reloadGEXFiltered()`: orchestrate stream lifecycle.

**API layer** (`src/public/js/api.js`):
- Pure data layer — no DOM manipulation, no imports from watchlist or UI modules.
- `openStream(symbol, { types, viewport, priceParams, expirations? })`: opens an `EventSource` to `/api/stream/:symbol` with the specified `types` and `priceParams`. Uses epoch-based stale detection (`_activeStreamId`) to discard events from superseded streams. Attaches typed event listeners:
  - `price` / `quote`: buffer data silently (no render).
  - `gex`: calls `viewport.mergeGEXChunk()` to accumulate into cold buffer. Emits `data:gex-chunk`.
  - `expirations`: emits `data:expirations` with expiration dates.
  - `done { type: "price" }`: calls `viewport.loadPriceData()` which emits `viewport:change` — all sections rebuild automatically. Emits `done:price`.
  - `done { type: "quote" }`: calls `viewport.setSpotPrice()`, emits `data:quote` with symbol and quote data, then emits `viewport:change`.
  - `done { type: "gex" }`: `viewport.commitGEX()` promotes cold to hot, emits `viewport:change`, then emits `done:gex`.
  - `done { type: "expiration" }`: emits `done:expiration`.
  - `done {}` (no type): emits `stream:end`, closes the EventSource.
  - `error`: emits `stream:error`, closes stream.
- `getPriceParams(freqVal, rangeVal)`: takes frequency and range values (not DOM elements) and returns params object.
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
- **SSE streaming with progressive GEX**: `src/routes/stream.ts` uses Server-Sent Events (`text/event-stream`) with typed events (`price`, `quote`, `gex`, `expirations`, `done`, `error`). GEX is streamed progressively — option chains are fetched in 7-day windows, and each chunk's GEX is sent as it resolves. The client accumulates GEX per strike (GEX is summable: `|gamma| * OI * 100 * spot`). Per-type `done` events (`done: { type }`) signal when each data type is complete, enabling targeted renders. The final `done: {}` (no type) closes the stream.
- **Modular chart sections**: The chart is split into `PriceChart`, `GEXSection`, and `VolumeSection`, each with its own Three.js canvas and scene. All share a `ViewportModel` for data and viewport state, coordinated via an `EventBus` with `viewport:change` events. Sections rebuild independently when the viewport changes.
- **Separation of data and rendering**: `ViewportModel` data setters (`loadPriceData`, `setSpotPrice`, `mergeGEXChunk`, `clearGEX`) don't directly trigger renders. `loadPriceData()` emits `viewport:change`; other mutations require explicit `bus.emit('viewport:change')` in the calling code. GEX uses hot/cold double-buffering: chunks accumulate in cold (`_coldGexLevels`), `commitGEX()` promotes to hot (`gexLevels`) before painting. This prevents pan/zoom during streaming from rendering incomplete GEX.
- **Expiration filter default**: the server computes a 60-day cutoff per chunk and returns `selectedExpirations` in each `gex` event payload. The client unions these additively — no duplicated logic.
- **Token persistence & refresh**: tokens are saved to `.tokens.json` and reloaded on restart so the user doesn't need to re-authenticate. The `@sudowealth/schwab-api` library has a bug in `mapToTokenData()` that recalculates `expiresAt` from `expires_in` on every call, making in-memory tokens appear to never expire. To work around this, `schwab.ts` tracks the real absolute `expiresAt` in a module-level variable (set via save/load callbacks) and exports `getValidAccessToken()` which forces a refresh 5 minutes before actual expiry. All routes must use `getValidAccessToken()` instead of `auth.getAccessToken()` directly.
- **Self-signed TLS**: `ensureCerts()` in `src/certs.ts` generates certs on first run if missing. Required because Schwab OAuth mandates HTTPS callback URLs.
- **Watchlist persistence**: sections are stored in `watchlist.json` (gitignored) as `[{ name, symbols }]` via REST endpoints in `src/routes/watchlist.ts`. The frontend sidebar (`watchlist.js`) uses targeted DOM mutations — no full re-renders after initial open. Per-symbol SSE quote streams are independent of the main chart stream. The main chart quote syncs to the watchlist row via the `data:quote` bus event handled in `main.js`.
- **Watchlist resize**: `resize.js` adds drag-to-resize on the `#wl-resize-handle` element between chart and sidebar (180–340px range). A `ResizeObserver` on the panel toggles a `.compact` CSS class below 280px, hiding the Change/Change% columns.
- **Section resize handles**: `LayoutManager` inserts `.section-resize-handle` divs between adjacent sections. On drag, all visible sections are expressed as proportional `flex: <ratio> 0 0%` values so the non-dragged section stays stable. On mouseup, the flex ratios remain — no pixel-to-flex conversion needed — so sections scale naturally when the container resizes (watchlist toggle/resize). CSS min-widths (price 200px, gex 120px, volume 80px) are enforced as percentage floor during drag.
- **ResizeObserver per section**: Each chart section (`BaseSection`) uses its own `ResizeObserver` on its container element. When the watchlist sidebar toggles or resizes, or section handles are dragged, the CSS flexbox reflows section widths and each section auto-rebuilds.
- **EventBus for decoupling**: Components communicate via `bus.emit()`/`bus.on()` instead of direct method calls. `viewport:change` triggers all section rebuilds. `interaction:crosshair` syncs hover highlights bidirectionally across all sections — PriceChart, GEXSection, and VolumeSection each emit crosshair events on mousemove and subscribe to events from other sections, showing a horizontal crosshair line at the corresponding price.

## Common Modification Patterns

**Adding a new API endpoint**: For new data types, add a handler in `src/routes/stream.ts` and register a new `types` value. For non-streaming endpoints, create a new route file in `src/routes/`. Use the `getSchwabAuth()` pattern to get the auth instance. Register the route in `src/server.ts`.

**Changing section sizes**: Default sizes are CSS classes `.section-gex` (width 22%) and `.section-volume` (width 13%) in `css/styles.css`. Price section is `flex: 1` and fills remaining space. Users can also drag section resize handles at runtime; `LayoutManager` overrides these with proportional flex ratios on drag.

**Adding a new chart section**: Create a new class extending `BaseSection`. Subscribe to `viewport:change` in the constructor. Call `this._initHighlightGroup()` if the section needs hover highlights. Add a container in `LayoutManager.init()` and register the section in `_sectionOrder`.

**Adding new UI controls**: Add HTML elements inside `<div id="header">` in `index.html`, style them in `css/styles.css`, and wire event listeners in `main.js`'s `init()` function.

**Changing GEX formula**: Modify `calculateGEX()` in `src/gex.ts`. The function receives the raw Schwab option chain object.

**Adjusting the date window size or cap**: Change the `intervalDays` default (currently `7`) in `buildDateWindows()` or the `2` (years) cap in `src/schwab.ts`. All date logic uses `estToday()` (US Eastern Time) to match options market conventions.

**Adjusting the default expiration filter**: Change the `60` (days) in `src/routes/stream.ts`'s `streamGEX()`. The client receives `selectedExpirations` from the server and applies it directly.

**Adding chart rendering features**: Add rendering logic inside the relevant section's `rebuild()` method (e.g., `PriceChart` for price overlays, `GEXSection` for GEX-related visuals, `VolumeSection` for volume visuals). Use `this.makePlane()`, `this.makeLine()`, or `this.batchPlanes()` from `BaseSection`. For dashed lines, use `THREE.LineDashedMaterial` with `computeLineDistances()`. For batched rectangles (e.g., candles), use `batchPlanes(rects, color)` which merges all rects into a single draw call.

**Volume alert dot**: In `VolumeSection._buildVolumeBars()`, a small orange circle (`COLORS.volumeAlert`) is rendered beside volume bars where `totalVolume > totalOI` (both must be > 0). This signals unusual activity at that strike.

**Dealer support/resistance lines**: `PriceChart._buildDealerLevels()` draws two dotted horizontal lines across the candle chart area: a red line (`COLORS.dealerResistance`) at the strike above spot with the highest positive net GEX (resistance), and a green line (`COLORS.dealerSupport`) at the strike below spot with the most negative net GEX (support). Uses a dedicated `dealerLevels` Three.js group. Each line is a single `THREE.Line` with `LineDashedMaterial`.
- **Batched candle rendering**: `PriceChart._buildCandles()` collects candle body and wick rects into arrays by color (up/down), then calls `batchPlanes()` once per color — 4 draw calls total instead of 2 per candle.
- **EventBus emit safety**: `emit()` iterates a shallow copy of the listeners array (`[...fns]`) so that listeners removed during emission don't cause skipped callbacks.
- **CSS.escape in watchlist selectors**: All `querySelector` calls in `watchlist.js` that use dynamic symbol or section names wrap values with `CSS.escape()` to prevent selector injection.
- **Watchlist PUT validation**: The `PUT /api/watchlist` endpoint validates that each section has a `name` string and `symbols` string array before writing to disk.
