# Home Game

Self-hosted No-Limit Texas Hold'em for home games with friends, with built-in video and audio. One Docker image, runs behind your own nginx.

- **Create a table** with a rule set: blind structure, level length, breaks, rebuy period, max rebuys, add-on, shot clock.
- **Share the link.** Friends pick a seat, enter a name and a buy-in. No accounts.
- **The server deals**, enforces betting (min-raise, short all-ins, side pots, split pots), runs the blind clock and settles hands.
- **Camera and microphone** per seat over WebRTC, with a TURN relay (coturn) for players behind strict NAT.
- **Ledger** of buy-ins, rebuys, cash-outs and net results.
- **Survives restarts.** Tables, ledgers and saved rule sets live in `/data`. A hand interrupted by a restart is voided and the bets are returned.

## Rule sets

Four presets ship with the app (cash game, home tournament, turbo, freezeout). Pick one when you open a table, press **Edit rules** to change anything, and **Save as new rule set** to reuse it next time. Saved rule sets are stored on the server in `/data/rulesets.json`. The host can change the rules mid-game from the **Rules** tab; new blinds apply from the next hand.

| Setting | Meaning |
|---|---|
| Blinds go up every | Level length in minutes. `0` = fixed blinds (cash game). After the last level the blinds keep doubling. |
| Break after every / length | e.g. a 5-minute break every 4 levels. The current hand plays out first. |
| Rebuy amount | Chips per rebuy. `0` lets the player choose (cash game). |
| Rebuy period, through level | Rebuys close after this level. `0` = all game. |
| Max rebuys per player | `0` = unlimited. |
| Who can rebuy | Only when busted, at or below a stack size, or anyone between hands. |
| Add-on | One per player, available during the chosen level and the next. |
| Time to act | Shot clock in seconds. On timeout the player checks if possible, otherwise folds. `0` = off. |

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. Camera and microphone work on `localhost` without HTTPS.

## Deploy (Unraid + Docker + nginx)

1. Copy `docker-compose.yml` and `.env.example` to the server and create the env file:
   ```bash
   cp .env.example .env
   ```
   Set `POKER_IMAGE` to your image (`ghcr.io/<github-user>/<repo>:latest`). Fill in `PUBLIC_HOST`, `TURN_HOST`, `PUBLIC_IP`, a random `TURN_SECRET` (`openssl rand -hex 32`) and `DATA_PATH` (e.g. `/mnt/user/appdata/homegame`). On Unraid keep `PUID=99` and `PGID=100`.
2. Pull and start (the image is built by GitHub Actions on every push to `main`):
   ```bash
   docker compose pull && docker compose up -d
   ```
   If the GHCR package is private, run `docker login ghcr.io` first with a GitHub token that has `read:packages`, or make the package public under the repo's Packages settings. To build locally instead: `docker build -t homegame-poker . ` and set `POKER_IMAGE=homegame-poker`.
3. Add the nginx site in [deploy/nginx-poker.conf](deploy/nginx-poker.conf): set your hostname, certificate paths and the Unraid IP/port in `proxy_pass`. It forwards the WebSocket upgrade that the game needs. **HTTPS is required** for camera and microphone.
4. Forward these ports on your router to the Unraid box:

   | Port | Protocol | For |
   |---|---|---|
   | `443` | TCP | nginx (the game and its WebSocket) |
   | `3478` | UDP and TCP | coturn (STUN/TURN) |
   | `49160-49200` | UDP | coturn relay ports (the actual audio/video) |

   Do not expose `3000`; only nginx on the LAN talks to it. coturn uses host networking, so its ports land directly on the Unraid IP.

Without the TURN ports most players still connect peer-to-peer; the relay is for those behind strict NAT or mobile networks. If you don't want video at all, remove the `coturn` service.

### Behind Cloudflare

The game itself works through Cloudflare's proxy (orange cloud): WebSockets are supported and Socket.IO pings every 25 s, well inside Cloudflare's 100 s idle timeout. Use SSL mode **Full (strict)** with a Let's Encrypt or Cloudflare Origin certificate in nginx.

TURN does not: Cloudflare's proxy only carries HTTP(S), not raw UDP. So:

- `PUBLIC_HOST` (e.g. `poker.example.com`): proxied, orange cloud.
- `TURN_HOST` (e.g. `turn.example.com`): an A record to your WAN IP, **DNS only (grey cloud)**. This exposes your home IP, which TURN needs anyway.

Port `443` then only has to accept traffic from Cloudflare; you can restrict it to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) in the router or firewall. The TURN ports must stay open to everyone. If your WAN IP changes, update the `TURN_HOST` record and `PUBLIC_IP`, then restart coturn.

Health check: `GET /api/health`.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `DATA_DIR` | `/data` | Tables, ledgers, rule sets |
| `STUN_URLS` | Google STUN | Comma-separated |
| `TURN_URLS` | none | Comma-separated `turn:` URLs (compose builds them from `TURN_HOST`) |
| `TURN_SECRET` | none | Shared with coturn `static-auth-secret` |
| `TABLE_TTL_DAYS` | `14` | Idle tables are deleted after this |

## Development

- `npm test` plays ~1000 random hands against the engine and checks that chips are conserved.
- `npx tsx server/bots.ts <tableId> 4` seats four bots that play automatically, handy for testing the UI alone.
- `npm run typecheck`, `npm run build`.

Play money only. No real-money handling.
