import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Smile } from 'lucide-react';
import { reactions, type Reaction, type SeatReactionEvent } from '../../../shared/reactions';
import { socket } from '../lib/socket';

/** How long a thrown reaction is in the air before it lands on the other seat. */
const FLIGHT_MS = 800;
const BUBBLE_MS = 2400;

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Close on a press outside `inside` (any of the given elements) or on Escape. */
function useDismiss(open: boolean, inside: RefObject<HTMLElement | null>[], close: (escape: boolean) => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      if (!inside.some((r) => r.current?.contains(event.target as Node))) latest.current(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') latest.current(true); };
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Choices({ label, onPick, children }: { label: string; onPick: (emoji: Reaction) => void; children?: ReactNode }) {
  return (
    <div className="reactions__choices" role="group" aria-label={label}>
      {(Object.keys(reactions) as Reaction[]).map((emoji) => (
        <button key={emoji} aria-label={reactions[emoji]} title={reactions[emoji]} onClick={() => onPick(emoji)}>{emoji}</button>
      ))}
      {children}
    </div>
  );
}

/** The dock's "Reager" button: the emoji shows over your own seat. */
export function ReactionPicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, [root], (escape) => {
    setOpen(false);
    if (escape) trigger.current?.focus();
  });

  return (
    <div className="reactions" ref={root} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} className="chipbtn reactions__trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Smile size={16} aria-hidden="true" /> Reager
      </button>
      {open && (
        <Choices label="Hurtigreaksjoner" onPick={(emoji) => {
          socket.volatile.emit('reaction', emoji);
          setOpen(false);
          trigger.current?.focus();
        }} />
      )}
    </div>
  );
}

/**
 * Opened by tapping another player's camera: pick an emoji to throw at them.
 * Rendered into <body> so the seat's transform and filters don't clip or shift it.
 */
export function ThrowMenu({ anchor, name, playerId, onClose, onManage }: {
  anchor: RefObject<HTMLElement | null>;
  name: string;
  playerId: string;
  onClose: () => void;
  onManage?: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const close = (refocus: boolean) => {
    onClose();
    if (refocus) anchor.current?.focus();
  };
  useDismiss(true, [menu, anchor], close);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const m = menu.current?.getBoundingClientRect();
      if (!a || !m) return;
      const gap = 6, edge = 8;
      const left = Math.min(Math.max(edge, a.left + a.width / 2 - m.width / 2), innerWidth - m.width - edge);
      const above = a.top - m.height - gap;
      const top = above >= edge ? above : Math.min(a.bottom + gap, innerHeight - m.height - edge);
      setAt({ left, top });
    };
    place();
    menu.current?.querySelector('button')?.focus({ preventScroll: true });
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor]);

  return createPortal(
    <div
      ref={menu}
      className="throw-menu"
      style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !menu.current?.contains(next) && !anchor.current?.contains(next)) onClose();
      }}
    >
      <p className="throw-menu__title">Kast på {name}</p>
      <Choices label={`Kast en reaksjon på ${name}`} onPick={(emoji) => {
        socket.volatile.emit('reaction', { emoji, to: playerId });
        close(true);
      }} />
      {onManage && <button className="throw-menu__manage" onClick={() => { onClose(); onManage(); }}>Spillere og innstillinger</button>}
    </div>,
    document.body,
  );
}

/** The bubble over a seat: your own reaction, or one thrown at you once it lands. */
export function SeatReaction({ playerId, name }: { playerId: string; name: string }) {
  const [current, setCurrent] = useState<{ emoji: Reaction; sequence: number; thrown: boolean } | null>(null);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let hide: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    const show = (emoji: Reaction, thrown: boolean) => {
      clearTimeout(hide);
      setCurrent({ emoji, sequence: ++sequence, thrown });
      hide = setTimeout(() => setCurrent(null), BUBBLE_MS);
    };
    const receive = (event: SeatReactionEvent) => {
      if (event.toId == null) {
        if (event.playerId === playerId) show(event.emoji, false);
      } else if (event.toId === playerId) {
        const timer = setTimeout(() => { timers.delete(timer); show(event.emoji, true); }, reducedMotion() ? 0 : FLIGHT_MS);
        timers.add(timer);
      }
    };
    socket.on('reaction', receive);
    return () => {
      socket.off('reaction', receive);
      clearTimeout(hide);
      timers.forEach(clearTimeout);
    };
  }, [playerId]);

  return (
    <span className="seat__reaction" role="status">
      {current && <span key={current.sequence} className={`seat__reaction-bubble ${current.thrown ? 'is-thrown' : ''}`}>
        <span aria-hidden="true">{current.emoji}</span>
        {/* a thrown reaction is announced by ReactionFlights, which knows who threw it */}
        {!current.thrown && <span className="sr-only">{name} reagerte med {reactions[current.emoji]}</span>}
      </span>}
    </span>
  );
}

interface Flight { key: number; emoji: Reaction; from: { x: number; y: number }; to: { x: number; y: number } }

function FlyingEmoji({ flight, onDone }: { flight: Flight; onDone: (key: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = flight;
    const dx = to.x - from.x, dy = to.y - from.y;
    // arc: the midpoint is lifted off the straight line, towards the top of the room
    const lift = Math.min(140, Math.hypot(dx, dy) * 0.3);
    const mid = { x: from.x + dx / 2, y: from.y + dy / 2 - lift };
    const spin = dx >= 0 ? 1 : -1;
    const at = (p: { x: number; y: number }, scale: number, turn: number) =>
      `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${scale}) rotate(${turn * spin}turn)`;
    const animation = el.animate([
      { transform: at(from, 0.5, 0), opacity: 0 },
      { transform: at(from, 1.1, 0.1), opacity: 1, offset: 0.12 },
      { transform: at(mid, 1.7, 0.6), opacity: 1, offset: 0.5 },
      { transform: at(to, 1.15, 1), opacity: 1, offset: 0.92 },
      { transform: at(to, 1, 1), opacity: 0 },
    ], { duration: FLIGHT_MS + 120, easing: 'cubic-bezier(0.45, 0, 0.4, 1)', fill: 'forwards' });
    animation.onfinish = () => onDone(flight.key);
    return () => animation.cancel();
  }, [flight, onDone]);
  return <span ref={ref} className="flight" aria-hidden="true">{flight.emoji}</span>;
}

/** Reactions thrown between seats fly across the room. Mount inside the room element. */
export function ReactionFlights({ room, names }: { room: RefObject<HTMLElement | null>; names: Record<string, string> }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [said, setSaid] = useState('');
  const latestNames = useRef(names);
  latestNames.current = names;

  useEffect(() => {
    let key = 0;
    const receive = (event: SeatReactionEvent) => {
      if (event.toId == null) return;
      const n = latestNames.current;
      setSaid(`${n[event.playerId] ?? 'En spiller'} kastet ${reactions[event.emoji]} på ${n[event.toId] ?? 'en spiller'}`);
      const box = room.current?.getBoundingClientRect();
      const centre = (id: string) => {
        const r = room.current?.querySelector(`[data-player="${CSS.escape(id)}"] .seat__frame`)?.getBoundingClientRect();
        return r && box ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : null;
      };
      const from = centre(event.playerId), to = centre(event.toId);
      if (!from || !to || reducedMotion()) return;
      setFlights((list) => [...list.slice(-11), { key: ++key, emoji: event.emoji, from, to }]);
    };
    socket.on('reaction', receive);
    return () => { socket.off('reaction', receive); };
  }, [room]);

  const done = useRef((k: number) => setFlights((list) => list.filter((f) => f.key !== k))).current;
  return (
    <>
      {flights.map((f) => <FlyingEmoji key={f.key} flight={f} onDone={done} />)}
      <span className="sr-only" role="status">{said}</span>
    </>
  );
}
