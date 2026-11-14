import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { BUILT_IN_RULESETS, sanitizeRules } from '../shared/presets';
import { isReaction, type SeatReactionEvent } from '../shared/reactions';
import type { Ack, RtcPeer, RuleSet, TableSettings } from '../shared/types';
import { archiveResult, deleteRuleSet, deleteTableFile, flushAll, listResults, listRuleSets, loadTables, saveRuleSet, saveTable } from './store';
import { cleanName, GameError, Table } from './table';
import { createDemoTable, driveBots } from './demo';

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = [join(here, 'client'), join(here, '..', 'dist', 'client')].find((d) => existsSync(join(d, 'index.html')));

/* ---------------- state ---------------- */

const tables = new Map<string, Table>();
for (const t of loadTables()) register(t);
console.log(`[poker] restored ${tables.size} table(s)`);

/** One-time codes for moving a seat to another device (QR handoff). */
interface Handoff { tableId: string; playerId: string; keepCam: boolean; expires: number }
const handoffs = new Map<string, Handoff>();
const HANDOFF_MS = 5 * 60 * 1000;

function register(t: Table) {
  tables.set(t.id, t);
  t.onChange = () => {
    if (!t.demo) saveTable(t);
    broadcast(t);
    driveBots(t);
  };
}

/* ---------------- http ---------------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => { res.json({ ok: true, tables: tables.size }); });

/** Lifetime of a TURN credential. Clients refetch before it runs out. */
const TURN_TTL_S = 6 * 3600;

/** ICE servers for WebRTC. TURN credentials follow coturn's use-auth-secret (REST API) scheme. */
app.get('/api/rtc-config', (_req, res) => {
  const iceServers: RTCIceServerLike[] = [];
  const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  const turnUrls = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  let expiresAt: number | undefined;
  if (turnUrls.length && secret) {
    const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_S;
    const username = `${expiry}:poker`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
    expiresAt = expiry * 1000;
  }
  res.json({ iceServers, expiresAt });
});

app.get('/api/season-results', (_req, res) => { res.set('Cache-Control', 'no-store').json(listResults()); });

app.get('/api/rulesets', (_req, res) => { res.json(listRuleSets()); });
app.post('/api/rulesets', (req, res) => {
  try { res.json(saveRuleSet(req.body as Partial<RuleSet>)); }
  catch (e) { res.status(400).json({ error: String((e as Error).message) }); }
});
app.delete('/api/rulesets/:id', (req, res) => {
  if (BUILT_IN_RULESETS.some((b) => b.id === req.params.id)) { res.status(400).json({ error: 'Innebygde regelsett kan ikke slettes.' }); return; }
  deleteRuleSet(req.params.id);
  res.json({ ok: true });
});

if (CLIENT_DIR) {
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h', setHeaders: (res, path) => {
    if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => { res.sendFile(join(CLIENT_DIR, 'index.html')); });
}

interface RTCIceServerLike { urls: string[]; username?: string; credential?: string }

/* ---------------- sockets ---------------- */

const http = createServer(app);
const io = new Server(http, { cors: { origin: process.env.CORS_ORIGIN ?? false }, pingInterval: 10000, pingTimeout: 15000 });

interface SocketData { tableId?: string; playerId?: string }
type S = Socket & { data: SocketData };

function broadcast(t: Table) {
  const room = io.sockets.adapter.rooms.get(t.id);
  if (!room) return;
  const cache = new Map<string | null, unknown>();
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid) as S | undefined;
    if (!s) continue;
    const pid = s.data.playerId ?? null;
    if (!cache.has(pid)) cache.set(pid, t.view(pid));
    s.emit('state', cache.get(pid));
  }
}

function rtcPeers(t: Table): RtcPeer[] {
  const room = io.sockets.adapter.rooms.get(t.id);
  const peers: RtcPeer[] = [];
  for (const sid of room ?? []) {
    const s = io.sockets.sockets.get(sid) as S | undefined;
    if (s) peers.push({ socketId: sid, playerId: s.data.playerId ?? null });
  }
  return peers;
}

function sendPeers(t: Table) { io.to(t.id).emit('rtc:peers', rtcPeers(t)); }

function guard<T>(ack: Ack<T> | undefined, fn: () => T | void) {
  try {
    const data = fn();
    ack?.({ ok: true, data: data as T });
  } catch (e) {
    if (!(e instanceof GameError)) console.error(e);
    ack?.({ ok: false, error: e instanceof GameError ? e.message : 'Noe gikk galt på serveren.' });
  }
}

function sanitizeSettings(input: Partial<TableSettings> & { rules?: Partial<RuleSet> }, prev?: TableSettings): TableSettings {
  return {
    name: String(input?.name ?? prev?.name ?? 'Poker').trim().slice(0, 40) || 'Poker',
    maxSeats: 9,
    requireApproval: input?.requireApproval ?? prev?.requireApproval ?? false,
    rules: sanitizeRules(input?.rules, prev?.rules ?? BUILT_IN_RULESETS[0]),
  };
}

function packetBudget(max: number) {
  let recent: number[] = [];
  return () => {
    const now = Date.now();
    recent = recent.filter((t) => now - t < 5000);
    if (recent.length >= max) return false;
    recent.push(now);
    return true;
  };
}

io.on('connection', (raw) => {
  const s = raw as S;
  const table = () => {
    const t = s.data.tableId ? tables.get(s.data.tableId) : undefined;
    if (!t) throw new GameError('Bordet finnes ikke lenger.');
    return t;
  };
  const me = () => {
    const t = table();
    const p = t.player(s.data.playerId);
    if (!p) throw new GameError('Velg et sete ved bordet først.');
    return { t, p };
  };
  const attach = (t: Table, playerId: string | undefined) => {
    const old = t.player(s.data.playerId);
    if (old && old.id !== playerId) { old.connections = Math.max(0, old.connections - 1); t.connectionChanged(old); }
    s.data.playerId = playerId;
    const p = t.player(playerId);
    if (p && old?.id !== p.id) { p.connections++; t.connectionChanged(p); }
  };

  const allowGamePacket = packetBudget(30);
  const allowReaction = packetBudget(5);
  // Offers, answers and trickled ICE candidates arrive in bursts for every peer at the table.
  const allowSignal = packetBudget(512);
  s.use(([event], next) => {
    if (event === 'reaction') {
      if (allowReaction()) next();
      return;
    }
    if (event === 'rtc:signal' ? allowSignal() : allowGamePacket()) next();
  });

  s.on('table:create', (input: { settings: Partial<TableSettings>; hostName: string }, ack: Ack<{ tableId: string; token: string }>) => guard(ack, () => {
    if (tables.size > 500) throw new GameError('Det er for mange åpne bord på serveren.');
    const settings = sanitizeSettings(input?.settings ?? {});
    const t = new Table(settings);
    register(t);
    const host = t.createPlayer(cleanName(input?.hostName), true);
    t.addLog('system', `${host.name} åpnet bordet.`);
    saveTable(t, true);
    return { tableId: t.id, token: host.token };
  }));

  s.on('demo:create', (input: { name?: string; bots?: number }, ack: Ack<{ tableId: string; token: string }>) => guard(ack, () => {
    if (tables.size > 500) throw new GameError('Det er for mange åpne bord på serveren.');
    const { table: t, hostToken } = createDemoTable(input?.name, input?.bots);
    register(t);
    return { tableId: t.id, token: hostToken };
  }));

  s.on('table:join', (input: { tableId: string; token?: string; handoff?: string }, ack: Ack<{ token: string; keepCam: boolean } | undefined>) => guard(ack, () => {
    const t = tables.get(String(input?.tableId ?? ''));
    if (!t) throw new GameError('Fant ikke bordet. Det kan ha blitt stengt.');
    let handed: { token: string; keepCam: boolean } | undefined;
    let playerId = t.byToken(input?.token)?.id;
    if (input?.handoff) {
      const h = handoffs.get(String(input.handoff));
      handoffs.delete(String(input.handoff));
      const p = h && h.tableId === t.id && h.expires > Date.now() ? t.player(h.playerId) : undefined;
      if (!p) throw new GameError('QR-koden har utløpt. Lag en ny på den andre skjermen.');
      playerId = p.id;
      handed = { token: p.token, keepCam: h!.keepCam };
    }
    if (s.data.tableId && s.data.tableId !== t.id) s.leave(s.data.tableId);
    s.data.tableId = t.id;
    s.join(t.id);
    attach(t, playerId);
    // A demo table deals as soon as its visitor arrives.
    if (t.demo && t.status === 'waiting' && t.player(playerId)?.isHost) t.start(playerId!);
    s.emit('state', t.view(s.data.playerId ?? null));
    t.onChange();
    sendPeers(t);
    if (handed) {
      // Tell the player's other screens that this device has taken over.
      for (const sid of io.sockets.adapter.rooms.get(t.id) ?? []) {
        const o = io.sockets.sockets.get(sid) as S | undefined;
        if (o && o.id !== s.id && o.data.playerId === playerId) o.emit('handoff:done', { keepCam: handed.keepCam });
      }
    }
    return handed;
  }));

  s.on('handoff:create', (input: { keepCam?: boolean }, ack: Ack<{ code: string; expiresInMs: number }>) => guard(ack, () => {
    const { t, p } = me();
    const now = Date.now();
    for (const [k, h] of handoffs) if (h.expires <= now || (h.tableId === t.id && h.playerId === p.id)) handoffs.delete(k);
    if (handoffs.size > 2000) throw new GameError('Det er for mange aktive QR-koder. Prøv igjen om et minutt.');
    const code = randomBytes(16).toString('base64url');
    handoffs.set(code, { tableId: t.id, playerId: p.id, keepCam: !!input?.keepCam, expires: now + HANDOFF_MS });
    return { code, expiresInMs: HANDOFF_MS };
  }));

  s.on('seat:request', (input: { seat: number; name: string; buyIn: number }, ack: Ack<{ token: string }>) => guard(ack, () => {
    const t = table();
    let p = t.player(s.data.playerId);
    let created = false;
    if (!p) { p = t.createPlayer(input?.name); created = true; }
    try {
      t.requestSeat(p, Number(input?.seat), input?.name, Number(input?.buyIn));
    } catch (e) {
      if (created) t.players.splice(t.players.indexOf(p), 1);
      throw e;
    }
    if (created) { attach(t, p.id); t.onChange(); sendPeers(t); }
    return { token: p.token };
  }));

  s.on('seat:leave', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.leaveSeat(p); }));
  s.on('seat:sitout', (v: boolean, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.setSittingOut(p, !!v); }));
  s.on('player:rename', (name: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.rename(p, name); }));
  s.on('player:rebuy', (amount: number, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.rebuy(p, Number(amount)); }));
  s.on('player:addon', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.addOn(p); }));
  s.on('player:show', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.show(p.id); }));
  s.on('player:rabbit', (handNumber: number, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.rabbitHunt(p.id, handNumber); }));
  s.on('player:media', (m: { camOn: boolean; micOn: boolean }, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.setMedia(p, m?.camOn, m?.micOn); }));

  s.on('action', (a: { type: string; amount?: number }, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    t.act(p.id, String(a?.type), Number(a?.amount ?? 0));
  }));

  s.on('chat', (text: string, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    const msg = String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
    if (!msg) return;
    t.log.push({ t: Date.now(), kind: 'chat', text: msg, by: p.name });
    if (t.log.length > 200) t.log.splice(0, t.log.length - 200);
    t.onChange();
  }));

  s.on('reaction', (emoji: unknown) => {
    const t = s.data.tableId ? tables.get(s.data.tableId) : undefined;
    const p = t?.player(s.data.playerId);
    if (!t || p?.status !== 'seated' || !isReaction(emoji)) return;
    io.to(t.id).emit('reaction', { playerId: p.id, emoji } satisfies SeatReactionEvent);
  });

  // host controls
  s.on('host:start', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.start(p.id); }));
  s.on('host:pause', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.pause(p.id); }));
  s.on('host:approve', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.approve(p.id, id); }));
  s.on('host:reject', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.reject(p.id, id); }));
  s.on('host:kick', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.kick(p.id, id); }));
  s.on('host:stack', (a: { playerId: string; stack: number }, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.adjustStack(p.id, a?.playerId, Number(a?.stack)); }));
  s.on('host:level', (i: number, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.setLevel(p.id, Number(i)); }));
  s.on('host:claim', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.claimHost(p.id); }));
  s.on('host:transfer', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.transferHost(p.id, id); }));
  s.on('host:settings', (input: Partial<TableSettings>, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    t.updateSettings(p.id, sanitizeSettings(input, t.settings));
  }));
  s.on('host:close', (_: unknown, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    if (!p.isHost) throw new GameError('Bare verten kan stenge bordet.');
    if (!t.demo) archiveResult(t);
    io.to(t.id).emit('table:closed');
    t.dispose();
    tables.delete(t.id);
    deleteTableFile(t.id);
  }));

  // WebRTC signalling relay (only between sockets in the same table)
  s.on('rtc:signal', (msg: { to: string; data: unknown }) => {
    const target = io.sockets.sockets.get(String(msg?.to)) as S | undefined;
    // Spectators only receive video, so at least one side must be a player.
    if (!target || !s.data.tableId || target.data.tableId !== s.data.tableId || (!s.data.playerId && !target.data.playerId)) return;
    target.emit('rtc:signal', { from: s.id, data: msg.data });
  });

  s.on('disconnect', () => {
    const t = s.data.tableId ? tables.get(s.data.tableId) : undefined;
    if (!t) return;
    const p = t.player(s.data.playerId);
    if (p) {
      p.connections = Math.max(0, p.connections - 1);
      if (p.connections === 0) { p.camOn = false; p.micOn = false; }
      t.connectionChanged(p);
    }
    t.onChange();
    sendPeers(t);
  });
});

/* ---------------- loops & lifecycle ---------------- */

/** Demo tables are dropped once nobody has been looking at them for this long. */
const DEMO_EMPTY_MS = 10 * 60 * 1000;
const demoEmptySince = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const t of tables.values()) {
    t.tick();
    if (!t.demo) continue;
    if (io.sockets.adapter.rooms.get(t.id)?.size) { demoEmptySince.delete(t.id); continue; }
    const since = demoEmptySince.get(t.id) ?? now;
    demoEmptySince.set(t.id, since);
    if (now - since > DEMO_EMPTY_MS) { t.dispose(); tables.delete(t.id); demoEmptySince.delete(t.id); }
  }
}, 1000);

const shutdown = () => {
  flushAll([...tables.values()].filter((t) => !t.demo));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

http.listen(PORT, () => console.log(`[poker] listening on :${PORT}${CLIENT_DIR ? '' : ' (no client build found, API only)'}`));
