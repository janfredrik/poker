// Dev helper: seat N bots at a table and let them play.  npx tsx server/bots.ts <tableId> [count] [url]
import { io } from 'socket.io-client';
const [tableId, countArg, url = 'http://localhost:3000'] = process.argv.slice(2);
const names = ['Stian', 'Ulrik', 'Cashmoney', 'Mari', 'Ola', 'Kari', 'Per', 'Siri'];
const count = Number(countArg ?? 3);
for (let i = 0; i < count; i++) {
  const s = io(url, { transports: ['websocket'] });
  const ask = (ev: string, p?: unknown) => new Promise<any>((res) => s.emit(ev, p, res));
  let me: string | null = null;
  let acting = false;
  s.on('connect', async () => {
    await ask('table:join', { tableId });
    for (let seat = 9; seat >= 1; seat--) {
      const r = await ask('seat:request', { seat, name: names[i], buyIn: 5000 });
      if (r.ok) { await ask('table:join', { tableId, token: r.data.token }); break; }
    }
  });
  s.on('state', async (v: any) => {
    me = v.you.playerId;
    const l = v.you.legal;
    if (!l || acting) return;
    acting = true;
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 1500));
    const roll = Math.random();
    const a = roll < 0.12 && !l.canCheck ? { type: 'fold' } : roll < 0.8 || !l.canRaise ? { type: l.canCheck ? 'check' : 'call' } : { type: 'raise', amount: l.minRaiseTo };
    await ask('action', a);
    acting = false;
    if (v.you.rebuy?.allowed && v.players.find((p: any) => p.id === me)?.stack === 0) await ask('player:rebuy', 5000);
  });
}
