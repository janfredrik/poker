import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { reactions, type Reaction, type SeatReactionEvent } from '../../../shared/reactions';
import { socket } from '../lib/socket';

export function ReactionPicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="reactions" ref={root} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} className="chipbtn reactions__trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Smile size={16} aria-hidden="true" /> Reager
      </button>
      {open && (
        <div className="reactions__choices" role="group" aria-label="Hurtigreaksjoner">
          {(Object.keys(reactions) as Reaction[]).map((emoji) => (
            <button key={emoji} aria-label={reactions[emoji]} title={reactions[emoji]} onClick={() => {
              socket.volatile.emit('reaction', emoji);
              setOpen(false);
              trigger.current?.focus();
            }}>{emoji}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SeatReaction({ playerId, name }: { playerId: string; name: string }) {
  const [current, setCurrent] = useState<{ emoji: Reaction; sequence: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let sequence = 0;
    const receive = (event: SeatReactionEvent) => {
      if (event.playerId !== playerId) return;
      clearTimeout(timer);
      setCurrent({ emoji: event.emoji, sequence: ++sequence });
      timer = setTimeout(() => setCurrent(null), 2400);
    };
    socket.on('reaction', receive);
    return () => {
      socket.off('reaction', receive);
      clearTimeout(timer);
    };
  }, [playerId]);

  return (
    <span className="seat__reaction" role="status">
      {current && <span key={current.sequence} className="seat__reaction-bubble">
        <span aria-hidden="true">{current.emoji}</span>
        <span className="sr-only">{name} reagerte med {reactions[current.emoji]}</span>
      </span>}
    </span>
  );
}
