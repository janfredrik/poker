import { useEffect, useRef } from 'react';
import { MicOff, WifiOff, Crown } from 'lucide-react';
import type { PublicPlayer, WinnerView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { PlayingCard } from './Card';

export function VideoFeed({ stream, muted, mirror }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} className={`feed ${mirror ? 'feed--mirror' : ''}`} autoPlay playsInline muted={muted} />;
}

/** Plays a remote participant's audio even when their camera is off. */
export function AudioOnly({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (a && a.srcObject !== stream) { a.srcObject = stream; void a.play().catch(() => {}); }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

interface SeatProps {
  seatNo: number;
  player: PublicPlayer | null;
  isYou: boolean;
  acting: boolean;
  turnLeft: number | null; // 0..1
  stream: MediaStream | null;
  speaking: boolean;
  winner: WinnerView | null;
  canSit: boolean;
  onSit: (seat: number) => void;
  onOpen?: (p: PublicPlayer) => void;
  pending?: boolean;
  face?: 'up' | 'down' | 'left' | 'right';
  usingBank?: boolean;
}

export function Seat({ seatNo, player, isYou, acting, turnLeft, stream, speaking, winner, canSit, onSit, onOpen, pending, face = 'up', usingBank }: SeatProps) {
  if (!player) {
    return (
      <div className="seat seat--empty">
        {canSit ? (
          <button className="seat__sit" onClick={() => onSit(seatNo)}>
            <span className="seat__sit-label">Sit here</span>
            <span className="seat__no">Seat {seatNo}</span>
          </button>
        ) : (
          <span className="seat__open"><span className="seat__no">Seat {seatNo}</span></span>
        )}
      </div>
    );
  }

  const showVideo = !!stream && (isYou ? player.camOn : player.camOn) && stream.getVideoTracks().length > 0;
  const cards = player.shownCards ?? (player.hasCards ? [null, null] : []);
  const out = player.status === 'seated' && player.stack === 0 && !player.inHand;
  const state = player.place != null && player.stack === 0 ? `Out · ${ordinal(player.place)}`
    : acting && usingBank ? 'Time bank'
    : pending ? 'Waiting for host'
    : !player.connected ? 'Away'
    : player.sittingOut ? 'Sitting out'
    : out ? 'Out of chips'
    : player.allIn ? 'All-in'
    : player.lastAction;

  return (
    <div
      data-face={face}
      className={[
        'seat',
        acting && 'is-acting',
        isYou && 'is-you',
        player.folded && 'is-folded',
        speaking && 'is-speaking',
        winner && 'is-winner',
        (player.sittingOut || !player.connected || out || pending) && 'is-idle',
      ].filter(Boolean).join(' ')}
    >
      <button className="seat__frame" onClick={() => onOpen?.(player)} aria-label={`${player.name}, ${formatChips(player.stack)} chips`}>
        {showVideo ? (
          <VideoFeed stream={stream} muted={isYou} mirror={isYou} />
        ) : (
          <span className="seat__avatar" aria-hidden="true">{initials(player.name)}</span>
        )}
        {!isYou && stream && !showVideo && <AudioOnly stream={stream} />}
        <span className="seat__badges">
          {player.isHost && <span className="badge" title="Host"><Crown size={12} strokeWidth={2.4} /></span>}
          {!player.connected && <span className="badge" title="Disconnected"><WifiOff size={12} strokeWidth={2.4} /></span>}
          {player.connected && !player.micOn && (player.camOn || isYou) && <span className="badge" title="Muted"><MicOff size={12} strokeWidth={2.4} /></span>}
        </span>
      </button>
      {cards.length > 0 && !isYou && (
        <span className={`seat__cards ${player.shownCards ? 'is-shown' : ''}`}>
          {cards.map((c, i) => (
            <PlayingCard key={i} card={c} faceDown={!c} size="sm" highlight={!!c && !!winner?.cards.includes(c)} />
          ))}
        </span>
      )}
      <div className="seat__plate">
        <span className="seat__name">{player.name}{isYou && <span className="seat__you"> (you)</span>}</span>
        <span className="seat__stack">{formatChips(player.stack)}</span>
      </div>
      <div className="seat__meta">
        {winner ? (
          <span className="seat__tag seat__tag--win">Wins {formatChips(winner.amount)}{winner.hand ? ` · ${winner.hand}` : ''}</span>
        ) : state ? (
          <span className={`seat__tag ${player.folded ? 'seat__tag--fold' : ''}`}>{state}</span>
        ) : null}
      </div>
      {acting && turnLeft != null && (
        <span className={`seat__timer ${usingBank ? 'is-bank' : ''}`} aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0, turnLeft)})` }} /></span>
      )}
    </div>
  );
}
