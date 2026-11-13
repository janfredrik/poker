import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { BUILT_IN_RULESETS, sanitizeRules } from '../shared/presets';
import type { Ack, RtcPeer, RuleSet, TableSettings } from '../shared/types';
import { deleteRuleSet, deleteTableFile, flushAll, listRuleSets, loadTables, saveRuleSet, saveTable } from './store';
import { cleanName, GameError, Table } from './table';

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = [join(here, 'client'), join(here, '..', 'dist', 'client')].find((d) => existsSync(join(d, 'index.html')));

/* ---------------- state ---------------- */

const tables = new Map<string, Table>();
for (const t of loadTables()) register(t);
console.log(`[poker] restored ${tables.size} table(s)`);

function register(t: Table) {
  tables.set(t.id, t);
  t.onChange = () => {
    saveTable(t);
    broadcast(t);
  };
}

/* ---------------- http ---------------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => { res.json({ ok: true, tables: tables.size }); });

/** ICE servers for WebRTC. TURN credentials follow coturn's use-auth-secret (REST API) scheme. */
app.get('/api/rtc-config', (_req, res) => {
  const iceServers: RTCIceServerLike[] = [];
  const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  const turnUrls = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (turnUrls.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:poker`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  res.json({ iceServers });
});

app.get('/api/rulesets', (_req, res) => { res.json(listRuleSets()); });
app.post('/api/rulesets', (req, res) => {
  try { res.json(saveRuleSet(req.body as Partial<RuleSet>)); }
  catch (e) { res.status(400).json({ error: String((e as Error).message) }); }
});
app.delete('/api/rulesets/:id', (req, res) => {
  if (BUILT_IN_RULESETS.some((b) => b.id === req.params.id)) { res.status(400).json({ error: 'Built-in rule sets cannot be deleted.' }); return; }
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
    if (s?.data.playerId) peers.push({ socketId: sid, playerId: s.data.playerId });
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
    ack?.({ ok: false, error: e instanceof GameError ? e.message : 'Something went wrong on the server.' });
  }
}

function sanitizeSettings(input: Partial<TableSettings> & { rules?: Partial<RuleSet> }, prev?: TableSettings): TableSettings {
  return {
    name: String(input?.name ?? prev?.name ?? 'Home game').trim().slice(0, 40) || 'Home game',
    maxSeats: 9,
    requireApproval: input?.requireApproval ?? prev?.requireApproval ?? false,
    rules: sanitizeRules(input?.rules, prev?.rules ?? BUILT_IN_RULESETS[0]),
  };
}

const rate = new Map<string, number[]>();
function limited(s: S, max = 30, windowMs = 5000) {
  const now = Date.now();
  const arr = (rate.get(s.id) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  rate.set(s.id, arr);
  return arr.length > max;
}

io.on('connection', (raw) => {
  const s = raw as S;
  const table = () => {
    const t = s.data.tableId ? tables.get(s.data.tableId) : undefined;
    if (!t) throw new GameError('This table no longer exists.');
    return t;
  };
  const me = () => {
    const t = table();
    const p = t.player(s.data.playerId);
    if (!p) throw new GameError('Take a seat first.');
    return { t, p };
  };
  const attach = (t: Table, playerId: string | undefined) => {
    const old = t.player(s.data.playerId);
    if (old && old.id !== playerId) { old.connections = Math.max(0, old.connections - 1); t.connectionChanged(old); }
    s.data.playerId = playerId;
    const p = t.player(playerId);
    if (p && old?.id !== p.id) { p.connections++; t.connectionChanged(p); }
  };

  s.use((_packet, next) => { if (limited(s)) return; next(); });

  s.on('table:create', (input: { settings: Partial<TableSettings>; hostName: string }, ack: Ack<{ tableId: string; token: string }>) => guard(ack, () => {
    if (tables.size > 500) throw new GameError('This server has too many tables open.');
    const settings = sanitizeSettings(input?.settings ?? {});
    const t = new Table(settings);
    register(t);
    const host = t.createPlayer(cleanName(input?.hostName), true);
    t.addLog('system', `${host.name} opened the table.`);
    saveTable(t, true);
    return { tableId: t.id, token: host.token };
  }));

  s.on('table:join', (input: { tableId: string; token?: string }, ack: Ack) => guard(ack, () => {
    const t = tables.get(String(input?.tableId ?? ''));
    if (!t) throw new GameError('No table with that link. It may have been closed.');
    if (s.data.tableId && s.data.tableId !== t.id) s.leave(s.data.tableId);
    s.data.tableId = t.id;
    s.join(t.id);
    attach(t, t.byToken(input?.token)?.id);
    s.emit('state', t.view(s.data.playerId ?? null));
    t.onChange();
    sendPeers(t);
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

  // host controls
  s.on('host:start', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.start(p.id); }));
  s.on('host:pause', (_: unknown, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.pause(p.id); }));
  s.on('host:approve', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.approve(p.id, id); }));
  s.on('host:reject', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.reject(p.id, id); }));
  s.on('host:kick', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.kick(p.id, id); }));
  s.on('host:stack', (a: { playerId: string; stack: number }, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.adjustStack(p.id, a?.playerId, Number(a?.stack)); }));
  s.on('host:level', (i: number, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.setLevel(p.id, Number(i)); }));
  s.on('host:transfer', (id: string, ack: Ack) => guard(ack, () => { const { t, p } = me(); t.transferHost(p.id, id); }));
  s.on('host:settings', (input: Partial<TableSettings>, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    t.updateSettings(p.id, sanitizeSettings(input, t.settings));
  }));
  s.on('host:close', (_: unknown, ack: Ack) => guard(ack, () => {
    const { t, p } = me();
    if (!p.isHost) throw new GameError('Only the host can close the table.');
    io.to(t.id).emit('table:closed');
    t.dispose();
    tables.delete(t.id);
    deleteTableFile(t.id);
  }));

  // WebRTC signalling relay (only between sockets in the same table)
  s.on('rtc:signal', (msg: { to: string; data: unknown }) => {
    const target = io.sockets.sockets.get(String(msg?.to)) as S | undefined;
    if (!target || !s.data.tableId || target.data.tableId !== s.data.tableId || !s.data.playerId) return;
    target.emit('rtc:signal', { from: s.id, data: msg.data });
  });

  s.on('disconnect', () => {
    rate.delete(s.id);
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

setInterval(() => { for (const t of tables.values()) t.tick(); }, 1000);

const shutdown = () => {
  flushAll(tables.values());
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

http.listen(PORT, () => console.log(`[poker] listening on :${PORT}${CLIENT_DIR ? '' : ' (no client build found, API only)'}`));
