# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GEX Dash — real-time Gamma Exposure visualization for equities/index options using the Schwab API. Express/TypeScript backend, vanilla JS + Three.js frontend (no bundler).

## Commands

```bash
npm run dev          # tsx watch src/server.ts — auto-reload development server
npm run build        # tsc && copy public/ to dist/
npm start            # node dist/server.js (run build first)
docker compose up --build  # full containerized run
```

Server runs at `https://127.0.0.1:3000` (HTTPS required for Schwab OAuth; self-signed certs auto-generated).

No test framework is configured. TypeScript strict mode is the primary correctness check.

## Architecture

**Backend** (`src/`):
- `server.ts` — Express setup, static serving, route registration, HTTPS bootstrap
- `schwab.ts` — OAuth setup, token persistence/refresh, all Schwab API fetch functions. Exports `getValidAccessToken()` which must be used instead of the library's `auth.getAccessToken()` (workaround for a library bug that miscalculates token expiry)
- `gex.ts` — Pure GEX calculation: `calculateGEX(optionChain, selectedExpirations?)` and `getExpirationDates()`
- `routes/auth.ts` — OAuth login/callback/status
- `routes/stream.ts` — SSE endpoint (`/api/stream/:symbol`) with progressive GEX streaming in 7-day windows
- `routes/watchlist.ts` — Watchlist CRUD (sections stored in `watchlist.json`)

**Frontend** (`src/public/`):
- Native ES modules, no build step. Three.js loaded via CDN import map.
- `js/main.js` — Entry point, app state, DOM event wiring
- `js/api.js` — Data layer using EventSource; manages stream lifecycle with epoch-based stale detection
- `js/chart/ViewportModel.js` — Shared data model with hot/cold GEX double-buffering
- `js/chart/EventBus.js` — Pub/sub for decoupled component communication
- `js/chart/BaseSection.js` — Base class for Three.js chart sections (own canvas, scene, camera)
- `js/chart/PriceChart.js`, `GEXSection.js`, `VolumeSection.js` — Independent chart sections
- `js/layout.js` — LayoutManager: section containers, flex-based resizable widths
- `js/watchlist.js` — Sidebar with SSE quotes, drag-to-reorder, context menu

**Key data flow**: Browser opens SSE → server fetches Schwab data in parallel → typed events stream back (`price`, `quote`, `gex` chunks, `expirations`) → per-type `done` events trigger targeted renders → final `done` (no type) closes stream.

**Key patterns**:
- GEX is additive per strike — chunks stream independently, accumulate in cold buffer, promote to hot on completion
- All chart sections share ViewportModel, coordinate via EventBus (`viewport:change`, `interaction:crosshair`)
- On-demand rendering (no animation loop) — sections rebuild only on viewport/data changes
- All date logic uses `estToday()` (US Eastern) to match options market conventions

## Environment

Requires `SCHWAB_CLIENT_ID` and `SCHWAB_CLIENT_SECRET` in `.env` (see `.env.example`). Optional: `PORT` (default 3000), `HOST` (default 127.0.0.1).

## Detailed Reference

See [AGENTS.md](../AGENTS.md) for complete file structure, key concepts, component details, and common modification patterns.

See [README.md](../README.md) for user-facing documentation, API endpoints, and chart interactions.
