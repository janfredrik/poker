/**
 * WebRTC ICE servers via Cloudflare Realtime TURN, plus a monthly usage watch.
 *
 * Browsers connect peer-to-peer first; TURN is only the fallback ICE picks when that fails.
 * The TURN key's API token never leaves the server: browsers get short-lived credentials.
 * Cloudflare includes 1 000 GB of Realtime egress per month; the watch below reads the
 * account's TURN egress from the GraphQL Analytics API, sends alerts as it nears that, and
 * (by default) stops handing out TURN credentials once it is reached.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export interface RtcConfig { iceServers: IceServer[]; expiresAt?: number }

const env = process.env;
const KEY_ID = env.CF_TURN_KEY_ID?.trim();
const KEY_TOKEN = env.CF_TURN_API_TOKEN?.trim();
const ACCOUNT_ID = env.CF_ACCOUNT_ID?.trim();
const ANALYTICS_TOKEN = env.CF_ANALYTICS_TOKEN?.trim();
/**
 * Credential lifetime. Clients refetch an hour before it runs out and a table shares one credential
 * while it has more than two hours left, so keep it at three hours or more. Short, so a leaked
 * credential is worthless after the evening.
 */
const TTL_S = Math.max(3, Number(env.TURN_TTL_HOURS) || 4) * 3600;
const LIMIT_GB = Number(env.TURN_MONTHLY_GB) || 1000;
const WARN_PCT = (env.TURN_WARN_PERCENT ?? '50,80,95').split(',').map(Number).filter((n) => n > 0 && n < 100).sort((a, b) => a - b);
const STOP_AT_LIMIT = env.TURN_STOP_AT_LIMIT !== 'false';
const BILLING_DAY = Math.min(28, Math.max(1, Math.floor(Number(env.TURN_BILLING_DAY) || 1)));
const WEBHOOK = env.ALERT_WEBHOOK_URL?.trim();
const WEBHOOK_FORMAT = env.ALERT_WEBHOOK_FORMAT === 'text' ? 'text' : 'json';
const STUN = (env.STUN_URLS ?? 'stun:stun.cloudflare.com:3478').split(',').map((s) => s.trim()).filter(Boolean);
const STATE_FILE = join(env.DATA_DIR ?? join(process.cwd(), 'data'), 'turn-usage.json');
const CHECK_MS = 15 * 60 * 1000;
const GB = 1e9;

export const turnConfigured = !!(KEY_ID && KEY_TOKEN);
const watchConfigured = turnConfigured && !!(ACCOUNT_ID && ANALYTICS_TOKEN);

/* ---------------- credentials ---------------- */

/**
 * Without TURN. `retryMs` makes clients ask again that soon: they refetch an hour before
 * `expiresAt`, so it is set an hour plus `retryMs` ahead.
 */
export function stunOnly(retryMs?: number): RtcConfig {
  const iceServers = STUN.length ? [{ urls: STUN }] : [];
  return retryMs ? { iceServers, expiresAt: Date.now() + 3600_000 + retryMs } : { iceServers };
}

/** Browsers block port 53, and those candidates only time out (Cloudflare's own advice: drop them). */
export function dropPort53(servers: IceServer[]): IceServer[] {
  return servers
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
}

export async function rtcConfig(): Promise<RtcConfig> {
  if (!turnConfigured) return stunOnly();
  if (STOP_AT_LIMIT && usage.usedBytes >= LIMIT_GB * GB) return stunOnly(3600_000);
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(KEY_ID!)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_S }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json() as { iceServers?: IceServer[] | IceServer };
    const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    const iceServers = dropPort53(list);
    if (!iceServers.some((s) => s.username)) throw new Error('no TURN server in response');
    return { iceServers, expiresAt: Date.now() + TTL_S * 1000 };
  } catch (e) {
    // Video keeps working for everyone who can connect directly.
    console.warn('[turn] Cloudflare credentials failed, falling back to STUN only:', (e as Error).message);
    return stunOnly(5 * 60_000);
  }
}

/** Shared credentials per table, so reloading the page doesn't mint new ones. */
const shared = new Map<string, Promise<RtcConfig>>();
const SHARE_MIN_LEFT_MS = 2 * 3600_000;

/**
 * Config for someone at table `key`. Everyone at the table gets the same TURN credential while it
 * has more than two hours left (clients refetch with an hour left, so they then get a fresh one).
 * The monthly limit is checked on every call, so a shared credential stops being handed out at the limit.
 */
export async function rtcConfigFor(key: string): Promise<RtcConfig> {
  if (!turnConfigured) return stunOnly();
  if (STOP_AT_LIMIT && usage.usedBytes >= LIMIT_GB * GB) return stunOnly(3600_000);
  const now = Date.now();
  if (shared.size > 1000) for (const [k, p] of shared) if (((await p).expiresAt ?? 0) < now) shared.delete(k);
  let p = shared.get(key);
  const cfg = p && await p;
  if (!cfg || !cfg.iceServers.some((s) => s.username) || (cfg.expiresAt ?? 0) - now < SHARE_MIN_LEFT_MS) {
    p = rtcConfig();
    shared.set(key, p);
  }
  return p!;
}

/** Forget a table's shared credential (the table was closed). */
export function forgetRtcConfig(key: string) { shared.delete(key); }

/* ---------------- monthly usage watch ---------------- */

interface UsageState { period: string; usedBytes: number; checkedAt: number; alerted: number[]; failAlerted?: boolean }

/** First day (UTC, YYYY-MM-DD) of the free-allowance period that contains `now`. */
export function periodStart(now: Date, billingDay = BILLING_DAY): string {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  if (now.getUTCDate() < billingDay) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(billingDay).padStart(2, '0')}`;
}

/** Thresholds (percent of the allowance) newly crossed that haven't been alerted on yet. */
export function newThresholds(usedBytes: number, limitBytes: number, alerted: number[], warn = WARN_PCT): number[] {
  const pct = (usedBytes / limitBytes) * 100;
  return [...warn, 100].filter((t) => pct >= t && !alerted.includes(t));
}

function loadState(): UsageState {
  const fresh: UsageState = { period: periodStart(new Date()), usedBytes: 0, checkedAt: 0, alerted: [] };
  try {
    if (!existsSync(STATE_FILE)) return fresh;
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as UsageState;
    return s.period === fresh.period ? { ...fresh, ...s } : fresh;
  } catch { return fresh; }
}

const usage: UsageState = loadState();

function saveState() {
  try {
    mkdirSync(join(STATE_FILE, '..'), { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(usage));
    renameSync(tmp, STATE_FILE);
  } catch (e) { console.warn('[turn] could not save usage state:', (e as Error).message); }
}

async function queryEgressBytes(from: string, to: string): Promise<number> {
  if (!/^[0-9a-f]{32}$/i.test(ACCOUNT_ID!)) throw new Error('CF_ACCOUNT_ID must be the 32-character account ID');
  const query = `{ viewer { accounts(filter: { accountTag: "${ACCOUNT_ID}" }) {
    callsTurnUsageAdaptiveGroups(limit: 1, filter: { date_geq: "${from}", date_leq: "${to}" }) { sum { egressBytes } }
  } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as {
    data?: { viewer?: { accounts?: { callsTurnUsageAdaptiveGroups?: { sum?: { egressBytes?: number } }[] }[] } };
    errors?: { message: string }[] | null;
  };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('account not found (check CF_ACCOUNT_ID and the token\'s Account Analytics permission)');
  return (account.callsTurnUsageAdaptiveGroups ?? []).reduce((n, g) => n + (g.sum?.egressBytes ?? 0), 0);
}

export async function sendAlert(title: string, message: string, extra: Record<string, unknown> = {}) {
  console.log(`[turn] ALERT ${title}: ${message}`);
  if (!WEBHOOK) return;
  try {
    const init: RequestInit = WEBHOOK_FORMAT === 'text'
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: title.replace(/[^\x20-\x7e]/g, '?') }, body: message }
      // `text` (Slack), `content` (Discord), `title`/`message` (Home Assistant webhooks and most others).
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message, text: `${title}: ${message}`, content: `**${title}**\n${message}`, ...extra }) };
    const res = await fetch(WEBHOOK, { ...init, signal: AbortSignal.timeout(10000) });
    if (!res.ok) console.warn(`[turn] alert webhook answered HTTP ${res.status}`);
  } catch (e) { console.warn('[turn] alert webhook failed:', (e as Error).message); }
}

const fmtGB = (bytes: number) => (bytes / GB).toLocaleString('nb-NO', { maximumFractionDigits: 1 });

async function checkUsage() {
  const now = new Date();
  const period = periodStart(now);
  if (usage.period !== period) Object.assign(usage, { period, usedBytes: 0, alerted: [], failAlerted: false });
  try {
    usage.usedBytes = await queryEgressBytes(period, now.toISOString().slice(0, 10));
    usage.checkedAt = Date.now();
    usage.failAlerted = false;
    for (const t of newThresholds(usage.usedBytes, LIMIT_GB * GB, usage.alerted)) {
      usage.alerted.push(t);
      const used = `${fmtGB(usage.usedBytes)} av ${LIMIT_GB} GB`;
      const extra = { usedGB: usage.usedBytes / GB, limitGB: LIMIT_GB, percent: t, periodStart: period };
      if (t >= 100) {
        await sendAlert('Poker: TURN-kvoten er brukt opp',
          STOP_AT_LIMIT
            ? `${used} TURN-trafikk siden ${period}. Nye videoforbindelser bruker ikke lenger TURN før neste periode; spillere som kan koble direkte merker ingenting.`
            : `${used} TURN-trafikk siden ${period}. Videre trafikk koster $0,05/GB.`, extra);
      } else {
        await sendAlert(`Poker: ${t} % av gratis TURN-kvote brukt`, `${used} TURN-trafikk siden ${period}.`, extra);
      }
    }
  } catch (e) {
    console.warn('[turn] usage check failed:', (e as Error).message);
    if (!usage.failAlerted) {
      usage.failAlerted = true;
      await sendAlert('Poker: kan ikke lese TURN-forbruket', `Spørringen mot Cloudflare feilet: ${(e as Error).message}. Varsler om kvoten virker ikke før dette er rettet.`);
    }
  }
  saveState();
}

export function startUsageWatch() {
  if (!turnConfigured) { console.log('[turn] Cloudflare TURN not configured: STUN only (peer-to-peer video)'); return; }
  if (!watchConfigured) { console.warn('[turn] CF_ACCOUNT_ID/CF_ANALYTICS_TOKEN not set: monthly usage is not watched and no alerts are sent'); return; }
  console.log(`[turn] watching TURN usage: alerts at ${[...WARN_PCT, 100].join(', ')} % of ${LIMIT_GB} GB${STOP_AT_LIMIT ? ', TURN off at 100 %' : ''}${WEBHOOK ? '' : ' (log only, no ALERT_WEBHOOK_URL)'}`);
  setTimeout(() => void checkUsage(), 5000).unref();
  setInterval(() => void checkUsage(), CHECK_MS).unref();
}

export function usageSummary() {
  if (!turnConfigured) return { turn: false };
  return {
    turn: true,
    watched: watchConfigured,
    periodStart: usage.period,
    usedGB: Math.round((usage.usedBytes / GB) * 10) / 10,
    limitGB: LIMIT_GB,
    checkedAt: usage.checkedAt ? new Date(usage.checkedAt).toISOString() : null,
    turnOff: STOP_AT_LIMIT && usage.usedBytes >= LIMIT_GB * GB,
  };
}
