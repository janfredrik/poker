import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crown, Link2, Pause, Play, Smartphone } from 'lucide-react';
import type { TableView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { call, prefs, socket, tokens } from '../lib/socket';
import { mesh, useMedia, useNow } from '../lib/media';
import { fakeCam } from '../lib/fakecam';
import { chipSound, unlockAudio, yourTurnSound } from '../lib/sound';
import { formatResults } from '../lib/results';
import { PlayingCard } from './Card';
import { ChipStack, setChipScale } from './Chips';
import { Dock } from './Dock';
import { Drawer, type DrawerTab } from './Drawer';
import { PhoneSheet } from './PhoneSheet';
import { Seat } from './Seat';
import { TopBar } from './TopBar';

type Pt = { x: number; y: number };

// Seat anchor points (% of the room), clockwise from "you" at the bottom.
const WIDE: Pt[] = [
  { x: 50, y: 85 }, { x: 26, y: 84 }, { x: 8.5, y: 64 }, { x: 8.5, y: 35 }, { x: 31, y: 16 },
  { x: 69, y: 16 }, { x: 91.5, y: 35 }, { x: 91.5, y: 64 }, { x: 74, y: 84 },
];
const TALL: Pt[] = [
  { x: 50, y: 89 }, { x: 14, y: 76 }, { x: 14, y: 54 }, { x: 14, y: 32 }, { x: 31, y: 10 },
  { x: 69, y: 10 }, { x: 86, y: 32 }, { x: 86, y: 54 }, { x: 86, y: 76 },
];
const CENTER: Pt = { x: 50, y: 48 };
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// A QR handoff link carries a one-time code in the fragment (never sent to the server as a URL).
// Read once at load so it survives StrictMode's double effects, and drop it from the address bar.
let pendingHandoff: string | null = new URLSearchParams(location.hash.slice(1)).get('handoff');
if (pendingHandoff) history.replaceState(null, '', location.pathname + location.search);

// Phones are where a seat gets handed off to, so offering the QR handoff there is pointless.
// Touch-only device whose short side is phone-sized (covers landscape too, excludes tablets).
const isPhone = window.matchMedia('(pointer: coarse) and (hover: none)').matches && Math.min(screen.width, screen.height) < 600;

function useTall() {
  const q = '(max-aspect-ratio: 4/5)';
  const [tall, setTall] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setTall(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return tall;
}

export function TablePage({ tableId, navigate }: { tableId: string; navigate: (p: string) => void }) {
  const [view, setView] = useState<TableView | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<boolean>(() => window.innerWidth >= 1500);
  const [tab, setTab] = useState<DrawerTab>('log');
  const [sitAt, setSitAt] = useState<number | null>(null);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const [seenLog, setSeenLog] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const [phoneOpen, setPhoneOpen] = useState(false);
  /** 'moved': this screen handed everything to a phone. 'camera': a phone plays, this screen keeps the camera. */
  const [handedOff, setHandedOff] = useState<'moved' | 'camera' | null>(null);
  /** On the phone after a handoff: 'remote' = the camera stays on the other screen, 'ask' = offer to turn it on here. */
  const [arrived, setArrived] = useState<'remote' | 'ask' | null>(() => (sessionStorage.getItem(`homegame:remoteCam:${tableId}`) ? 'remote' : null));
  const media = useMedia();
  const tall = useTall();
  const now = useNow(!!view?.hand?.turnEndsAt, 100);

  /* ---- connection ---- */
  useEffect(() => {
    const join = () => {
      const code = pendingHandoff;
      pendingHandoff = null;
      call<{ token: string; keepCam: boolean } | undefined>('table:join', { tableId, token: tokens.get(tableId), handoff: code ?? undefined })
        .then((res) => {
          if (!res) return;
          tokens.set(tableId, res.token);
          try {
            if (res.keepCam) sessionStorage.setItem(`homegame:remoteCam:${tableId}`, '1');
            else sessionStorage.removeItem(`homegame:remoteCam:${tableId}`);
          } catch { /* private mode */ }
          setArrived(res.keepCam ? 'remote' : 'ask');
        })
        .catch((e: Error) => setFatal(e.message));
    };
    const onHandoff = async ({ keepCam }: { keepCam: boolean }) => {
      setPhoneOpen(false);
      setArrived(null);
      try { sessionStorage.removeItem(`homegame:remoteCam:${tableId}`); } catch { /* private mode */ }
      if (keepCam) { setHandedOff('camera'); return; }
      setHandedOff('moved');
      await mesh.stopAll();
      socket.disconnect();
    };
    const onState = (v: TableView) => {
      mesh.setIdentity(v.you.playerId);
      setView(v);
    };
    const onClosed = () => setFatal('Verten har stengt bordet.');
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    socket.on('state', onState);
    socket.on('table:closed', onClosed);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('handoff:done', onHandoff);
    if (socket.connected) join();
    return () => {
      socket.off('state', onState);
      socket.off('table:closed', onClosed);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('handoff:done', onHandoff);
    };
  }, [tableId]);

  const run = useCallback(async (event: string, payload?: unknown) => {
    unlockAudio();
    setBusy(true);
    try {
      return await call(event, payload);
    } catch (e) {
      setToast((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  const fire = useCallback((event: string, payload?: unknown) => { run(event, payload).catch(() => {}); }, [run]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (media.error) { setToast(media.error); mesh.clearError(); } }, [media.error]);

  /* ---- your-turn cues ---- */
  const myTurn = !!view?.you.legal;
  const prevTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !prevTurn.current) yourTurnSound();
    prevTurn.current = myTurn;
    const base = view && view.settings.name !== 'Poker' ? `${view.settings.name} · Poker` : 'Poker';
    document.title = myTurn ? `Din tur · ${base}` : base;
  }, [myTurn, view?.settings.name]);

  const potRef = useRef(0);
  useEffect(() => {
    const total = view?.hand ? view.hand.potTotal + view.players.reduce((s, p) => s + p.bet, 0) : 0;
    if (total > potRef.current) chipSound();
    potRef.current = total;
  }, [view?.hand?.potTotal, view?.players]);

  /* ---- payouts: remember where the pot sits so the chips can fly from there to the winners ---- */
  const roomRef = useRef<HTMLElement>(null);
  const potElRef = useRef<HTMLDivElement>(null);
  const potFrom = useRef<Pt>(CENTER);
  useLayoutEffect(() => {
    if (!view?.hand || view.hand.winners) return;
    const room = roomRef.current?.getBoundingClientRect();
    const pot = (potElRef.current?.querySelector('.chips') ?? potElRef.current)?.getBoundingClientRect();
    if (!room || !pot || !room.width || !room.height) return;
    potFrom.current = {
      x: ((pot.left + pot.width / 2 - room.left) / room.width) * 100,
      y: ((pot.top + pot.height / 2 - room.top) / room.height) * 100,
    };
  });
  const paidHand = useRef<number | null>(null);
  useEffect(() => {
    const h = view?.hand;
    if (!h?.winners?.length || paidHand.current === h.number) return;
    paidHand.current = h.number;
    const t = setTimeout(chipSound, 650);
    return () => clearTimeout(t);
  }, [view?.hand?.number, view?.hand?.winners]);

  /* ---- derived ---- */
  const me = view?.players.find((p) => p.id === view.you.playerId) ?? null;
  const mySeat = me?.status === 'seated' ? me.seat : me?.status === 'pending' ? me.requestedSeat : null;
  const anchors = tall ? TALL : WIDE;
  const maxSeats = view?.settings.maxSeats ?? 9;
  const posOf = useCallback((seat: number) => {
    const offset = mySeat ?? 1;
    return anchors[((seat - offset) % maxSeats + maxSeats) % maxSeats];
  }, [anchors, mySeat, maxSeats]);

  const bySeat = useMemo(() => {
    const m = new Map<number, TableView['players'][number]>();
    for (const p of view?.players ?? []) {
      if (p.status === 'seated' && p.seat) m.set(p.seat, p);
      else if (p.status === 'pending' && p.requestedSeat) m.set(p.requestedSeat, p);
    }
    return m;
  }, [view?.players]);

  const unread = (view?.log.filter((e) => e.kind === 'chat').length ?? 0) - seenLog;
  useEffect(() => {
    if (drawer && tab === 'log' && view) setSeenLog(view.log.filter((e) => e.kind === 'chat').length);
  }, [drawer, tab, view]);

  if (fatal) {
    return (
      <main className="gone">
        <h1>{fatal}</h1>
        <button className="btn btn--act" onClick={() => navigate('/')}>Åpne et nytt bord</button>
      </main>
    );
  }
  if (handedOff === 'moved') {
    return (
      <main className="gone">
        <Smartphone size={40} aria-hidden="true" />
        <h1>Du spiller nå på mobilen</h1>
        <p className="gone__wait">Mobilen har overtatt kamera og mikrofon. Denne skjermen er koblet fra bordet.</p>
        <button className="btn btn--quiet" onClick={() => { setHandedOff(null); socket.connect(); }}>Fortsett på denne skjermen</button>
      </main>
    );
  }
  if (!view) return <main className="gone"><p className="gone__wait">Åpner bordet …</p></main>;

  const hand = view.hand;
  setChipScale(view.settings.rules.levels[0]?.sb ?? 25);
  const acting = hand?.toActId ?? null;
  const actingSeat = acting ? view.players.find((p) => p.id === acting)?.seat ?? null : null;
  const winnerSeat = hand?.winners?.length ? view.players.find((p) => p.id === hand.winners![0].playerId)?.seat ?? null : null;
  const lampSeat = actingSeat ?? winnerSeat;
  const lamp = lampSeat ? lerp(posOf(lampSeat), CENTER, 0.18) : CENTER;
  const turnLeft = !hand?.turnMs ? null
    : hand.turnEndsAt ? Math.max(0, (hand.turnEndsAt - now) / hand.turnMs)
    : hand.frozenMs != null ? Math.max(0, hand.frozenMs / hand.turnMs) : null;
  const pausedMidHand = view.status === 'paused' && !!hand && !hand.winners;
  const canSit = !me || me.status === 'watching';
  const seatedCount = view.players.filter((p) => p.status === 'seated').length;
  const winCards = new Set(hand?.winners?.flatMap((w) => w.cards) ?? []);
  const pots = hand?.pots ?? [];
  const potTotal = hand?.potTotal ?? 0;
  const potWithBets = potTotal + view.players.reduce((sum, p) => sum + p.bet, 0);
  // where a player's chips sit on the felt: between their seat and the pot
  const betSpot = (pos: Pt): Pt => tall && pos.y >= 25 && pos.y <= 70
    ? { x: pos.x + (CENTER.x - pos.x) * 0.5, y: pos.y + (pos.y < CENTER.y ? -4 : 4) }
    : lerp(pos, CENTER, pos.y < 25 ? 0.5 : tall ? 0.55 : 0.4);

  const copyLink = async () => {
    const url = `${location.origin}/t/${view.id}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt('Kopier lenken', url); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyResults = async () => {
    const text = formatResults(view);
    try {
      await navigator.clipboard.writeText(text);
      setToast('Resultatene er kopiert');
    } catch {
      setManualCopy(text);
    }
  };

  const sit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '');
    const buyIn = Number(String(fd.get('buyIn') ?? '').replace(/\D/g, ''));
    try {
      const res = (await run('seat:request', { seat: sitAt, name, buyIn })) as { token: string };
      if (res?.token) tokens.set(view.id, res.token);
      prefs.set('name', name.trim());
      setSitAt(null);
    } catch { /* toast shown */ }
  };

  const tourney = view.settings.rules.levelMinutes > 0;
  const host = view.players.find((p) => p.isHost) ?? null;
  const openSeat = Array.from({ length: maxSeats }, (_, i) => i + 1).find((s) => !bySeat.has(s)) ?? null;
  const guest = canSit && !view.you.isHost;

  return (
    <div className={`app ${drawer ? 'has-drawer' : ''}`} onPointerDown={unlockAudio}>
      <TopBar
        view={view}
        camOn={media.camOn}
        micOn={media.micOn}
        mediaBusy={media.busy}
        canMedia={!!me}
        hideMedia={arrived === 'remote'}
        onPhone={me && view.you.playerId && !isPhone ? () => setPhoneOpen(true) : undefined}
        onCam={() => void mesh.setCam(!media.camOn)}
        onMic={() => void mesh.setMic(!media.micOn)}
        onCopy={copyLink}
        copied={copied}
        onStart={() => fire('host:start')}
        onPause={() => fire('host:pause')}
        drawerOpen={drawer}
        onDrawer={() => setDrawer((d) => !d)}
        unread={Math.max(0, unread)}
        watchers={media.spectators + view.players.filter((x) => x.status === 'watching' && x.connected && x.id !== view.you.playerId).length}
      />

      <main ref={roomRef} className={`room ${acting ? 'has-turn' : ''}`} style={{ ['--lamp-x' as string]: `${lamp.x}%`, ['--lamp-y' as string]: `${lamp.y}%` }}>
        <div className={`room__lamp ${acting ? 'is-turn' : ''}`} aria-hidden="true" />
        <div className="felt" aria-hidden="false">
          <div className="felt__center">
            {view.shuffling > 0 ? (
              <div className="felt__waiting shuffle" aria-live="polite">
                <h2 className="felt__title">Trekker seter</h2>
                <div className="shuffle__steps" aria-label={`Trekning ${view.shuffling} av 3`}>
                  {[1, 2, 3].map((n) => <span key={n} className={n <= view.shuffling ? 'is-done' : ''} />)}
                </div>
                <p className="felt__text">{view.shuffling < 3 ? `Runde ${view.shuffling} av 3` : 'Setene er fordelt. Deler ut kort …'}</p>
              </div>
            ) : view.status === 'finished' ? (
              <div className="felt__waiting results">
                <h2 className="felt__title">{view.players.find((p) => p.place === 1)?.name ?? 'En spiller'} vinner turneringen</h2>
                {view.results ? (
                  <ol className="results__list">
                    {view.results.places.map((pl) => (
                      <li key={pl.place} className={pl.place === 1 ? 'is-first' : ''}>
                        <span className="results__place">{pl.place}</span>
                        <span className="results__name">{pl.name ?? '—'}</span>
                        <span className="results__prize">{formatChips(pl.prize)} {view.results!.currency}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="felt__text">Du finner sluttresultatene i regnskapet.</p>
                )}
                <div className="felt__actions">
                  <button className="btn btn--quiet" onClick={() => { setDrawer(true); setTab('ledger'); }}>Vis oppgjøret</button>
                  <button className="btn btn--act" onClick={copyResults}>Kopier resultater</button>
                  <button className="btn btn--quiet" onClick={() => navigate('/')}>Nytt bord</button>
                </div>
              </div>
            ) : hand && !(view.status !== 'running' && hand.winners) ? (
              <>
                <div className="pot" aria-live="polite" ref={potElRef}>
                  {potTotal > 0 && <ChipStack amount={potTotal} label={false} size="lg" />}
                  <span className="pot__label">{hand.winners ? 'Hånden er ferdig' : 'Pot'}</span>
                  <span className="pot__amount">{formatChips(hand.winners ? hand.winners.reduce((s, w) => s + w.amount, 0) : potWithBets)}</span>
                  {pots.length > 1 && (
                    <span className="pot__side">
                      {pots.map((p, i) => <span key={i}>{i === 0 ? 'Main pot' : `Side pot ${i}`} {formatChips(p.amount)}</span>)}
                    </span>
                  )}
                </div>
                <div className="board" aria-label="Board">
                  {Array.from({ length: 5 }, (_, i) => {
                    const c = hand.board[i] ?? hand.rabbitCards?.[i - hand.board.length];
                    return c ? (
                      <PlayingCard key={c} card={c} size="md" highlight={winCards.has(c)} dim={i >= hand.board.length || (!!hand.winners && winCards.size > 0 && !winCards.has(c))} delay={i < 3 ? i * 80 : 0} />
                    ) : <PlayingCard key={`e${i}`} empty size="md" />;
                  })}
                </div>
                {hand.winners && hand.winners[0]?.hand && (
                  <p className="felt__result">
                    {hand.winners.map((w) => `${view.players.find((p) => p.id === w.playerId)?.name ?? 'En spiller'} · ${w.hand}`).join('  ·  ')}
                  </p>
                )}
              </>
            ) : (
              <div className="felt__waiting">
                {view.status === 'waiting' && guest ? (
                  <div className="invite">
                    <h2 className="invite__title">{view.settings.name}</h2>
                    <p className="invite__by">
                      {host ? <><b>{host.name}</b> er vert · </> : null}{seatedCount} av {maxSeats} seter opptatt
                    </p>
                    <dl className="invite__terms">
                      <div><dt>Blinds</dt><dd>{formatChips(view.clock.level.sb)}/{formatChips(view.clock.level.bb)}</dd></div>
                      <div><dt>{tourney ? 'Startstack' : 'Buy-in'}</dt><dd>{formatChips(view.settings.rules.startingStack)}</dd></div>
                      {tourney && <div><dt>Nivåer</dt><dd>{view.settings.rules.levelMinutes} min</dd></div>}
                    </dl>
                    <div className="felt__actions">
                      <button className="btn btn--act btn--lg invite__cta" disabled={openSeat == null} onClick={() => openSeat != null && setSitAt(openSeat)}>
                        {openSeat == null ? 'Bordet er fullt' : 'Velg et sete'}
                      </button>
                    </div>
                    <p className="felt__hint">{openSeat == null ? 'Du kan se på mens du venter på et ledig sete.' : 'Du kan også velge et ledig sete ved bordet.'}</p>
                  </div>
                ) : view.status === 'waiting' ? (
                  <>
                    <h2 className="felt__title">{seatedCount < 2 ? 'Venter på spillere' : 'Klar til spill'}</h2>
                    <p className="felt__text">
                      {seatedCount} av {maxSeats} seter opptatt · {formatChips(view.clock.level.sb)}/{formatChips(view.clock.level.bb)}{tourney ? `, ${view.settings.rules.levelMinutes} min per nivå` : ''}
                    </p>
                    <div className="felt__actions">
                      {view.you.isHost && (
                        <button className="btn btn--act" disabled={seatedCount < 2} onClick={() => fire('host:start')}>
                          <Play size={16} /> Start spillet
                        </button>
                      )}
                      <button className="btn btn--quiet" onClick={copyLink}><Link2 size={16} /> {copied ? 'Lenken er kopiert' : 'Kopier invitasjonslenken'}</button>
                    </div>
                    {view.you.isHost && seatedCount < 2 && <p className="felt__hint">Velg et sete og send lenken til de andre.</p>}
                    {!view.you.isHost && <p className="felt__hint">Verten starter spillet.</p>}
                  </>
                ) : view.status === 'paused' ? (
                  <>
                    <h2 className="felt__title">På pause</h2>
                    <p className="felt__text">{view.you.isHost ? 'Fortsett når alle er tilbake.' : 'Verten starter spillet igjen.'}</p>
                    {view.you.isHost && <div className="felt__actions"><button className="btn btn--act" onClick={() => fire('host:start')}><Play size={16} /> Fortsett</button></div>}
                  </>
                ) : view.clock.onBreak ? (
                  <>
                    <h2 className="felt__title">Pause</h2>
                    <p className="felt__text">Neste hånd deles ut når pausen er over.</p>
                  </>
                ) : (
                  <>
                    <h2 className="felt__title">Venter på spillere</h2>
                    <p className="felt__text">Neste hånd starter så snart to spillere har chips.</p>
                  </>
                )}
              </div>
            )}
            {hand && view.you.canRabbitHunt && (
              <button className="btn btn--quiet btn--sm" disabled={busy} onClick={() => fire('player:rabbit', hand.number)}>Rabbit hunt</button>
            )}
            {!!hand?.rabbitCards?.length && (
              <div className="felt__waiting" role="status">
                <span className="felt__text">Rabbit hunt · {hand.board.length === 0 ? 'Flop, turn og river' : hand.board.length === 3 ? 'Turn og river' : 'River'}</span>
                {view.status !== 'running' && (
                  <div className="board">{hand.rabbitCards.map((card) => <PlayingCard key={card} card={card} size="sm" />)}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {Array.from({ length: maxSeats }, (_, i) => {
          const seatNo = i + 1;
          const p = bySeat.get(seatNo) ?? null;
          const pos = posOf(seatNo);
          const isYou = !!p && p.id === view.you.playerId;
          // On a phone whose camera stayed on the other screen, show that screen's feed on your own seat.
          // Demo bots get a drawn camera feed.
          const stream = !p ? null : p.bot ? fakeCam(p.id, p.name)
            : isYou ? media.local ?? media.streams[p.id] ?? null : media.streams[p.id] ?? null;
          // occupied seats are keyed by player so a seat shuffle animates faces across the table
          return (
            <div className={`seat-anchor ${p ? 'is-taken' : ''}`} key={p ? p.id : `seat-${seatNo}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <Seat
                seatNo={seatNo}
                player={p}
                isYou={isYou}
                acting={!!p && p.id === acting}
                turnLeft={p && p.id === acting ? turnLeft : null}
                usingBank={!!p && p.id === acting && !!hand?.usingBank}
                stream={stream}
                speaking={!!p && !!media.speaking[p.id]}
                winner={hand?.winners?.find((w) => w.playerId === p?.id) ?? null}
                canSit={canSit}
                onSit={setSitAt}
                pending={p?.status === 'pending'}
                onOpen={() => { if (view.you.isHost) { setDrawer(true); setTab('players'); } }}
                face={pos.y > 70 ? 'up' : pos.y < 25 ? 'down' : pos.x < 50 ? 'right' : 'left'}
                holeCards={isYou ? view.you.holeCards : undefined}
              />
            </div>
          );
        })}

        {/* bets and dealer button sit on the felt between the seat and the pot */}
        {view.players.filter((p) => p.status === 'seated' && p.seat).map((p) => {
          const pos = posOf(p.seat!);
          const b = betSpot(pos);
          const d = lerp(pos, CENTER, tall ? 0.44 : 0.27);
          return (
            <div key={p.id}>
              {p.bet > 0 && (
                <div className="bet" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
                  <ChipStack amount={p.bet} size="sm" />
                </div>
              )}
              {hand && hand.dealerSeat === p.seat && (
                <div className="markers" style={{ left: `${d.x + (pos.x < 45 ? 5 : pos.x > 55 ? -5 : 7)}%`, top: `${d.y}%` }}>
                  <span className="marker marker--dealer" title="Dealer">D</span>
                </div>
              )}
            </div>
          );
        })}

        {/* the pot slides over to whoever won it, then into their stack */}
        {hand?.winners?.map((w, i) => {
          const seat = view.players.find((p) => p.id === w.playerId)?.seat;
          if (!seat || w.amount <= 0) return null;
          const pos = posOf(seat);
          const to = betSpot(pos);
          const from = potFrom.current;
          return (
            <div key={`${hand.number}-${w.playerId}`} className="payout" aria-hidden="true" style={{
              ['--fx' as string]: `${from.x}%`, ['--fy' as string]: `${from.y}%`,
              ['--tx' as string]: `${to.x}%`, ['--ty' as string]: `${to.y}%`,
              ['--sx' as string]: `${pos.x}%`, ['--sy' as string]: `${pos.y}%`,
              animationDelay: `${i * 180}ms`,
            }}>
              <ChipStack amount={w.amount} size="md" />
            </div>
          );
        })}

        {manualCopy && (
          <div className="sheet-wrap">
            <section className="sheet" role="dialog" aria-labelledby="copy-results-title">
              <h2 id="copy-results-title" className="sheet__title">Kopier resultater</h2>
              <textarea aria-label="Resultater til kopiering" readOnly autoFocus rows={9}
                value={manualCopy} onFocus={(e) => e.currentTarget.select()} />
              <div className="sheet__actions">
                <button className="btn btn--quiet" onClick={() => setManualCopy('')}>Ferdig</button>
              </div>
            </section>
          </div>
        )}
        {sitAt != null && (
          <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) setSitAt(null); }}>
            <SitSheet
              seat={sitAt}
              tableName={view.settings.name}
              defaultName={me?.name ?? prefs.get('name')}
              stack={view.settings.rules.startingStack}
              fixed={tourney}
              ask={view.settings.requireApproval && !view.you.isHost}
              busy={busy}
              onSubmit={sit}
              onCancel={() => setSitAt(null)}
            />
          </div>
        )}

        {rebuyOpen && view.you.rebuy && (
          <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) setRebuyOpen(false); }}>
            <form
              className="sheet"
              onSubmit={async (e) => {
                e.preventDefault();
                const amt = Number(String(new FormData(e.currentTarget).get('amount') ?? '').replace(/\D/g, ''));
                try { await run('player:rebuy', amt); setRebuyOpen(false); } catch { /* toast */ }
              }}
            >
              <h2 className="sheet__title">Rebuy</h2>
              <label className="field">
                <span className="field__label">Chips</span>
                <input name="amount" inputMode="numeric" defaultValue={view.settings.rules.startingStack} required autoFocus />
              </label>
              <div className="sheet__actions">
                <button type="button" className="btn btn--quiet" onClick={() => setRebuyOpen(false)}>Avbryt</button>
                <button className="btn btn--act" disabled={busy}>Legg til chips</button>
              </div>
            </form>
          </div>
        )}

        {phoneOpen && (
          <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) setPhoneOpen(false); }}>
            <PhoneSheet tableId={view.id} camOn={media.camOn} onClose={() => setPhoneOpen(false)} />
          </div>
        )}

        {arrived === 'ask' && (
          <div className="sheet-wrap">
            <div className="sheet">
              <h2 className="sheet__title">{me?.name ? `Velkommen tilbake, ${me.name}!` : 'Velkommen tilbake!'}</h2>
              <p className="field__hint">Du spiller nå på denne mobilen. Slå på kameraet og mikrofonen slik at de andre kan se og høre deg.</p>
              <div className="sheet__actions">
                <button className="btn btn--quiet" onClick={() => setArrived(null)}>Ikke nå</button>
                <button className="btn btn--act" onClick={async () => { setArrived(null); unlockAudio(); await mesh.setCam(true); await mesh.setMic(true); }}>Slå på kamera og mikrofon</button>
              </div>
            </div>
          </div>
        )}

        {handedOff === 'camera' && (
          <div className="banner banner--action" role="status">
            <Smartphone size={15} aria-hidden="true" /> Du spiller på mobilen. Kameraet er fortsatt på her.
            <button className="btn btn--quiet btn--sm" onClick={() => setHandedOff(null)}>OK</button>
          </div>
        )}

        {!connected ? <div className="banner" role="status">Kobler til bordet på nytt …</div>
          : pausedMidHand ? (
            <div className="banner banner--action" role="status">
              <Pause size={15} aria-hidden="true" /> {view.you.isHost ? 'Spillet er satt på pause. Hånden fortsetter når du starter igjen.' : 'Verten har satt spillet på pause. Hånden fortsetter når verten starter igjen.'}
              {view.you.isHost && <button className="btn btn--act btn--sm" onClick={() => fire('host:start')}><Play size={14} /> Fortsett</button>}
            </div>
          ) : view.you.canClaimHost && !handedOff ? (
            <div className="banner banner--action" role="status">
              <Crown size={15} aria-hidden="true" /> Verten har mistet forbindelsen.
              <button className="btn btn--quiet btn--sm" onClick={() => fire('host:claim')}>Overta som vert</button>
            </div>
          ) : null}
        {toast && <div className="toast" role="alert" onClick={() => setToast(null)}>{toast}</div>}
      </main>

      <Dock
        view={view}
        canReact={connected && !handedOff}
        busy={busy}
        onAction={(type, amount) => fire('action', { type, amount })}
        onRebuy={() => { if (view.you.rebuy?.amount) fire('player:rebuy', view.you.rebuy.amount); else setRebuyOpen(true); }}
        onAddOn={() => fire('player:addon')}
        onSitOut={(v) => fire('seat:sitout', v)}
        onShow={() => fire('player:show')}
      />

      {drawer && <Drawer view={view} tab={tab} setTab={setTab} run={run} onClose={() => setDrawer(false)} />}
    </div>
  );
}

function SitSheet({ seat, tableName, defaultName, stack, fixed, ask, busy, onSubmit, onCancel }: {
  seat: number; tableName: string; defaultName: string; stack: number; fixed: boolean; ask: boolean; busy: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const [buyIn, setBuyIn] = useState(String(stack));
  const amount = fixed ? stack : Number(buyIn.replace(/\D/g, '')) || 0;
  return (
    <form className="sheet sheet--felt sitdown" onSubmit={onSubmit}>
      <div className="sitdown__head">
        <h2 className="sheet__title">Sete {seat}</h2>
        <span className="sitdown__table">{tableName}</span>
      </div>
      <div className="sitdown__stack" aria-live="polite">
        <span className="sitdown__chips">{amount > 0 && <ChipStack amount={amount} label={false} size="lg" spread />}</span>
        <span className="sitdown__amount">{formatChips(amount)}</span>
        <span className="sitdown__unit">{fixed ? 'chips, likt for alle' : 'chips ved start'}</span>
      </div>
      <label className="field">
        <span className="field__label">Navnet ditt ved bordet</span>
        <input name="name" defaultValue={defaultName} maxLength={18} required autoFocus autoComplete="nickname" />
      </label>
      {fixed ? (
        <input type="hidden" name="buyIn" value={stack} />
      ) : (
        <label className="field">
          <span className="field__label">Buy-in</span>
          <input name="buyIn" inputMode="numeric" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} required />
        </label>
      )}
      {ask && <p className="field__hint">Verten må godkjenne setet ditt før du får kort.</p>}
      <div className="sheet__actions">
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Avbryt</button>
        <button className="btn btn--act" disabled={busy || amount <= 0}>{ask ? 'Be om sete' : 'Velg et sete'}</button>
      </div>
    </form>
  );
}
