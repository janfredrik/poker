# Poker

Self-hosted No-Limit Texas Hold'em for home games with friends, with built-in video and audio.

- **Create a table** with a rule set: blind structure, level length, breaks, rebuy period, max rebuys, add-on, shot clock.
- **Share the link.** Friends pick a seat, enter a name and a buy-in. No accounts.
- **The server deals**, enforces betting (min-raise, short all-ins, side pots, split pots), runs the blind clock and settles hands.
- **Camera and microphone** per seat over WebRTC, peer-to-peer first, with Cloudflare Realtime TURN as the relay for players behind strict NAT.
- **Ledger** of buy-ins, rebuys, cash-outs and net results.
- **Season standings** in the lobby show each finished tournament and calendar-year totals by player name. Use the same name each night. Net totals use the agreed settlement currency. The player stats tab tracks VPIP, PFR, showdowns won and the biggest pot collected in chips. Results stay in `DATA_DIR/results` after tables close or expire. Existing finished table files contribute their standings on upgrade. Hand stats begin with the first hand tracked.
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
| Rabbit hunt | Off by default. After a fold ends a hand before the river, anyone dealt into that hand can reveal the remaining community cards to the table. |

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. Camera and microphone work on `localhost` without HTTPS.

## Deploy

1. Copy `docker-compose.yml` and `.env.example` to the server and create the env file:
   ```bash
   cp .env.example .env
   ```
   Set `POKER_IMAGE` to your image (`ghcr.io/<github-user>/<repo>:latest`) and `DATA_PATH`, then fill in the Cloudflare values (see [Video relay](#video-relay-cloudflare-turn)).
2. Pull and start (the image is built by GitHub Actions on every push to `main`):
   ```bash
   docker compose pull && docker compose up -d
   ```
3. Add the web/nginx site in [deploy/nginx-poker.conf](deploy/nginx-poker.conf): set your hostname, certificate paths and the Unraid IP/port in `proxy_pass`. It forwards the WebSocket upgrade that the game needs. **HTTPS is required** for camera and microphone.
4. Forward only `443/TCP` (nginx) on your router. Do not expose `3000`; only web/nginx on the LAN talks to it. No TURN or media ports are needed at home.

### Behind Cloudflare's proxy

The game works through Cloudflare's proxy (orange cloud) and your nginx as before: WebSockets are supported and Socket.IO pings every 25 s, well inside Cloudflare's 100 s idle timeout. Use SSL mode **Full (strict)** with a Let's Encrypt or Cloudflare Origin certificate in nginx. No Cloudflare Tunnel is needed.

Port `443` only has to accept traffic from Cloudflare; you can restrict it to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) in the router or firewall.

Health check: `GET /api/health` (also shows this month's TURN usage).

### Video relay (Cloudflare TURN)

Camera and microphone go **peer-to-peer** between browsers whenever possible. When two players can't reach each other directly (strict NAT, some mobile and corporate networks), the browser falls back to Cloudflare's TURN relay at `turn.cloudflare.com`, including TURN over TLS on port 443 that gets through most firewalls. Media is end-to-end encrypted (DTLS-SRTP), so the relay can't see or hear it. Players see each other's IP addresses on direct connections, as with any peer-to-peer video.

1. In the Cloudflare dashboard, go to **Realtime > TURN Server** and create a TURN key. Put its **Key ID** in `CF_TURN_KEY_ID` and its **API token** in `CF_TURN_API_TOKEN`. The token stays on the server; browsers get short-lived credentials over the socket (4 h by default, refreshed automatically on long nights), and only while they are at a real table with someone else there. Everyone at a table shares one credential; demo tables get STUN only.
2. For usage alerts, create an API token under **My Profile > API Tokens** with the permission **Account > Account Analytics > Read**, and set `CF_ACCOUNT_ID` (the 32-character ID in the dashboard URL) and `CF_ANALYTICS_TOKEN`.
3. Set `ALERT_WEBHOOK_URL` to where you want alerts (below), then restart the container. The log should say `[turn] watching TURN usage: ...`.

If the Cloudflare API is unreachable, the server falls back to STUN only (direct video keeps working) and clients retry after a few minutes.

**Cost.** Cloudflare includes 1 000 GB of Realtime traffic per month (shared by TURN, SFU and MoQ), then $0.05/GB. Only relayed connections count. Even with all video of a 7-player table relayed, that is roughly 20 GB per hour of play.

**Alerts.** Every 15 minutes the server reads the account's TURN egress for the current billing period from Cloudflare's GraphQL Analytics API (it lags about a minute). It sends one alert per period at each of `TURN_WARN_PERCENT` (50, 80, 95 %) and at 100 %, and one if it can't read the usage at all. At 100 % it stops handing out TURN credentials until the next period (`TURN_STOP_AT_LIMIT=true`), so you are never billed; players who connect directly notice nothing. Alerts always go to the container log, and are POSTed to `ALERT_WEBHOOK_URL`:

- **Home Assistant** (phone push via the companion app): an automation with a *Webhook* trigger (allow `POST`, untick "only accessible from local network" if Home Assistant is not on the same network), and the action `notify.mobile_app_<phone>` with `title: "{{ trigger.json.title }}"` and `message: "{{ trigger.json.message }}"`. Use `http://<ha>:8123/api/webhook/<id>` as the URL.
- **Discord / Slack**: an incoming-webhook URL; `content` / `text` are in the JSON.
- **ntfy**: `https://ntfy.sh/<secret-topic>` with `ALERT_WEBHOOK_FORMAT=text`.

As a second line of defence in Cloudflare itself, add a budget alert under **Manage Account > Billing > Billable Usage > Create budget alert** with a threshold of $1 and your email. It only fires once there is actual spend (past the free 1 000 GB), so it catches the case where the app's own watch is broken. Under **Notifications > Add**, check whether *Usage Based Billing* offers Realtime TURN for your account as well.

The included traffic follows Cloudflare's billing period. If yours doesn't start on the 1st, set `TURN_BILLING_DAY`.

### Testing the relay

1. Open a table in two browsers. In devtools, under the WebSocket messages of `/socket.io`, the reply to `rtc:config` should list `stun:stun.cloudflare.com` and `turn:turn.cloudflare.com` / `turns:` URLs with a username and an `expiresAt`. No URLs on port 53 (browsers block them).
2. Test the relay alone: open [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/), add one `turns:turn.cloudflare.com:443?transport=tcp` URL with the username and credential from step 1, and gather: a candidate of type **relay** means TURN works.
3. Test across networks: one player on home Wi-Fi, one on a phone with Wi-Fi off (mobile data), ideally one on a work or guest network. Everyone should see and hear each other. In Chrome, `chrome://webrtc-internals` shows for each connection whether the selected candidate pair is `host`/`srflx` (direct) or `relay` (TURN).
4. To force the relay in a test, run a separate Chrome with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, or block UDP on one test machine. The connection should come up as `relay`.
5. A few minutes later, **Realtime > TURN Server** in the dashboard and `GET /api/health` should show the traffic.

### Moving from coturn

After the relay test above succeeds, remove the old `coturn` container (`docker compose up -d --remove-orphans`), close router forwards `3478` UDP/TCP and `49160-49200` UDP, and delete the grey-cloud `TURN_HOST` DNS record. `TURN_HOST`, `PUBLIC_IP`, `TURN_SECRET`, `TURN_URLS` are no longer used.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `DATA_DIR` | `/data` | Tables, ledgers, rule sets, TURN usage state |
| `CREATE_CODE` | none | If set, opening a table and saving/deleting rule sets require this code. Joining by link and demo tables stay open. Each IP gets 10 table attempts and 15 demo tables per hour, with at most 3 demos live at once |
| `TABLE_TTL_DAYS` | `14` | Idle tables are deleted after this. Tables where no hand was ever dealt are deleted after 24 h with nobody connected |
| `CF_TURN_KEY_ID` | none | Cloudflare Realtime TURN key ID. Without it and the token: STUN only |
| `CF_TURN_API_TOKEN` | none | The TURN key's API token (server only) |
| `TURN_TTL_HOURS` | `4` | Lifetime of the credentials browsers get (minimum 3); refreshed an hour before expiry |
| `STUN_URLS` | Cloudflare STUN | Comma-separated, only used when TURN is not available |
| `CF_ACCOUNT_ID` | none | For the usage watch |
| `CF_ANALYTICS_TOKEN` | none | API token with Account Analytics Read |
| `TURN_MONTHLY_GB` | `1000` | Free allowance the alerts are measured against |
| `TURN_WARN_PERCENT` | `50,80,95` | Alert thresholds; 100 % always alerts |
| `TURN_STOP_AT_LIMIT` | `true` | Stop handing out TURN credentials at 100 % until the next period |
| `TURN_BILLING_DAY` | `1` | Day of month the billing period starts (1-28) |
| `ALERT_WEBHOOK_URL` | none | Where alerts are POSTed |
| `ALERT_WEBHOOK_FORMAT` | `json` | `json` (`title`, `message`, `text`, `content`, `usedGB`, `limitGB`, `percent`) or `text` (ntfy) |
| `OPENROUTER_API_KEY` | none | AI dealer's brain. She exists only with this, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (see `DEALER.md`) |
| `DEALER_MODEL` | `anthropic/claude-haiku-5.5` | OpenRouter model for her lines |
| `DEALER_MAX_PER_HOUR` | `60` | Fresh lines and answers per table per hour |
| `ELEVENLABS_API_KEY` | none | Her voice |
| `ELEVENLABS_VOICE_ID` | none | A Norwegian female voice from your ElevenLabs voice library |
| `ELEVENLABS_MODEL_LIVE` | `eleven_v4_turbo` | Voice model for fresh lines |
| `ELEVENLABS_MODEL_FIXED` | `eleven_v4` | Voice model for fixed lines (made once, kept in `DATA_DIR/dealer/`) |
| `AZURE_SPEECH_KEY` | none | Speech-to-text so players can talk to her (push-to-talk) |
| `AZURE_SPEECH_REGION` | none | Azure Speech region, e.g. `norwayeast` |

## Development

- `npm test` plays ~1000 random hands against the engine and checks that chips are conserved.
- `npx tsx server/bots.ts <tableId> 4` seats four bots that play automatically, handy for testing the UI alone.
- `npm run typecheck`, `npm run build`.