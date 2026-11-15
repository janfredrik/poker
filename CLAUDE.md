# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Self-hosted No-Limit Texas Hold'em for home games with friends, with per-seat video over WebRTC. Play money only: the app may calculate the group's settlement but never moves or holds money. See `PRODUCT.md` for product intent and `DESIGN.md` for the visual system (walnut/teal-felt/lamp-amber palette; amber is reserved for "what you can do now").

## Commands

```bash
npm install
npm run dev          # server (tsx watch, :3000) + Vite client (:5173, proxies /api and /socket.io to :3000)
npm run typecheck    # two passes: tsconfig.json (client + shared) and tsconfig.server.json (server + shared)
npm test             # tsx server/selftest.ts — the only test suite
npm run build        # vite → dist/client, esbuild → dist/server.js
npm start            # node dist/server.js (serves dist/client if present)
npx tsx server/bots.ts <tableId> 4   # seat 4 bots that play automatically against a running server
```

There is no test runner and no way to run a single test: `server/selftest.ts` is one script of `assert(...)` calls (hand-evaluator cases, scenario blocks, then ~400 random games checking chip conservation). It sets `POKER_FAST=1` (shortens engine delays) and `DATA_DIR=/tmp/poker-selftest`. Add new cases as blocks in that file. CI (`.github/workflows/docker.yml`) runs typecheck + test, then builds and pushes the Docker image to GHCR on `main`.

`.claude/launch.json` runs the built `dist/server.js` on :3000 (or :3107), so `npm run build` before previewing.

## Architecture

Three source roots, one package:

- `server/` — Node + Express + Socket.IO. **The server is authoritative for all game logic**; the client only renders views and emits intents.
- `client/src/` — React 18 + Vite SPA, no router library (`main.tsx` matches `/t/:tableId` → `TablePage`, else `Lobby`).
- `shared/` — `types.ts` (wire types: `TableView`, `RuleSet`, `Ack`, …) and `presets.ts` (built-in rule sets + `sanitizeRules`). Imported by both sides; keep it free of Node/DOM-specific code.

### Server flow

- `server/table.ts` — the `Table` class is the whole engine: seating/approval, betting (`act`, `legal`), side pots, showdown, blind clock (`tick`, called every second from `index.ts`), rebuys/add-ons, tournament places and payouts, ledger. Throw `GameError` for user-facing rule violations; its message is shown to the player verbatim. Any other exception becomes a generic error.
- Every mutation ends by calling `t.onChange()`, which `index.ts` wires to `saveTable` (debounced 400 ms atomic JSON write) + `broadcast`. Forgetting `onChange()` means clients don't update and state isn't persisted.
- `broadcast` sends each socket `t.view(playerId)`, a **per-viewer projection**. Hidden information (other players' hole cards) must only be exposed through `view()`; never emit raw `Table`/hand state.
- `server/index.ts` — socket handlers follow one pattern: `s.on('event', (input, ack) => guard(ack, () => { const { t, p } = me(); t.method(...) }))`. Host-only methods take `hostId` and check it inside `Table`. Inputs are untrusted: coerce with `Number()`/`String()` and sanitize (`sanitizeSettings`, `sanitizeRules`, `cleanName`). There's a per-socket rate limit.
- Identity: no accounts. A player is a per-browser `token` in localStorage (`homegame:token:<tableId>`); `table:join` with the token reattaches the socket to the player. Sockets without a player are spectators. QR "handoff" codes (`handoff:create`) move a seat to another device.
- `server/store.ts` — persistence under `DATA_DIR` (default `./data`, `/data` in Docker): `tables/<id>.json` via `Table.snapshot()` and `rulesets.json`. Tables idle past `TABLE_TTL_DAYS` are deleted on load. A hand interrupted by a restart is voided and bets returned. When adding fields to `Table`/`Player`, update `snapshot()` and restoration so they survive restarts.
- `server/cards.ts` — deck and `bestHand` evaluator (score + human-readable name).

### Client

- `client/src/lib/socket.ts` — single socket instance; `call(event, payload)` wraps emit-with-ack as a Promise that rejects with the server's error message.
- `client/src/table/TablePage.tsx` holds the latest `TableView` and composes `TopBar`, `Seat`, `Dock` (action buttons), `Drawer` (log/ledger/rules/host tabs), `PhoneSheet`.
- `client/src/lib/media.ts` — WebRTC mesh. The server only relays `rtc:signal` between sockets on the same table and publishes `rtc:peers`; at least one side of a connection must be a seated player (spectators receive only). ICE/TURN config comes from the `rtc:config` socket event (TURN only for sockets at a non-demo table with others present, one shared credential per table): `server/turn.ts` fetches short-lived Cloudflare Realtime TURN credentials and watches monthly TURN egress (alerts via `ALERT_WEBHOOK_URL`, TURN off at the free limit).

### Rule sets

`RuleSet` (in `shared/types.ts`) drives blinds structure (last level lasts forever), breaks, rebuys, add-on, payouts, shot clock and time bank. Built-ins live in `shared/presets.ts` and can't be deleted; user-saved ones go to `/api/rulesets`. Rule changes mid-game apply from the next hand. The README's rule-set table documents user-facing semantics.

## Deployment

One Docker image (`Dockerfile`, the only service in `docker-compose.yml`) behind the owner's nginx (`deploy/nginx-poker.conf`, must forward the WebSocket upgrade; HTTPS required for camera/mic). Env vars are documented in the README (`PORT`, `DATA_DIR`, `TABLE_TTL_DAYS`, `CF_TURN_*`, `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, `TURN_*`, `ALERT_WEBHOOK_*`). The relay is Cloudflare's, so no TURN ports are open at home.

## Conventions

- UI copy is in Norwegian Bokmål with established English poker terminology.
- Commit messages are a single sentence describing the user-visible change (e.g. "Let players continue on their phone by scanning a QR code").
