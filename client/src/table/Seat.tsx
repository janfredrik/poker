import { useEffect, useRef, useState } from 'react';
import { MicOff, WifiOff, Crown, Volume2, Bot } from 'lucide-react';
import type { Card, PublicPlayer, WinnerView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { PlayingCard } from './Card';
import { SeatReaction } from './Reactions';

function VideoFeed({ stream, mirror }: { stream: MediaStream; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.srcObject = stream;
    return () => { v.srcObject = null; };
  }, [stream]);
  return <video ref={ref} className={`feed ${mirror ? 'feed--mirror' : ''}`} autoPlay playsInline muted />;
}

function RemoteAudio({ stream, name }: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  function play(a: HTMLAudioElement) {
    void a.play().catch((error: DOMException) => {
      if (a.srcObject === stream && error.name === 'NotAllowedError') setBlocked(true);
    });
  }
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.srcObject = stream;
    setBlocked(false);
    play(a);
    return () => { a.srcObject = null; };
  }, [stream]);
  return <>
    <audio ref={ref} onPlaying={() => setBlocked(false)} />
    {blocked && (
      <button className="seat__enable-audio" aria-label={`Enable sound for ${name}`} onClick={() => ref.current && play(ref.current)}>
        <Volume2 size={14} aria-hidden="true" /> Enable sound
      </button>
    )}
  </>;
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
  /** Your own hole cards, shown face up on your seat. Only ever passed for your own seat. */
  holeCards?: Card[];
}

export function Seat({ seatNo, player, isYou, acting, turnLeft, stream, speaking, winner, canSit, onSit, onOpen, pending, face = 'up', usingBank, holeCards }: SeatProps) {
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

  const showVideo = player.camOn && stream && stream.getVideoTracks().some((track) => track.readyState === 'live');
  const cards = player.shownCards ?? (player.hasCards ? [null, null] : []);
  const out = player.status === 'seated' && player.stack === 0 && !player.inHand;
  const state = player.place != null && player.stack === 0 ? `Out · ${ordinal(player.place)}`
    : acting && usingBank ? 'Time bank'
    : pending ? 'Waiting for host'
    : !player.connected ? 'Disconnected'
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
          <VideoFeed stream={stream} mirror={isYou} />
        ) : (
          <span className="seat__avatar" aria-hidden="true">{initials(player.name)}</span>
        )}
        <span className="seat__badges">
          {player.isHost && <span className="badge" title="Host"><Crown size={12} strokeWidth={2.4} /></span>}
          {!player.connected && <span className="badge" title="Disconnected"><WifiOff size={12} strokeWidth={2.4} /></span>}
          {player.bot && <span className="badge" title="Bot"><Bot size={12} strokeWidth={2.4} /></span>}
          {player.connected && !player.bot && !player.micOn && (player.camOn || isYou) && <span className="badge" title="Muted"><MicOff size={12} strokeWidth={2.4} /></span>}
        </span>
      </button>
      {player.status === 'seated' && <SeatReaction playerId={player.id} name={player.name} />}
      {player.equity != null && (
        <div className="seat__equity" title="Main pot equity · tied hands share the pot">
          <span className="sr-only">{player.name}, main pot equity </span>
          {Number(player.equity.toFixed(1))}% <span aria-hidden="true">equity</span>
        </div>
      )}
      {!isYou && stream && stream.getAudioTracks().length > 0 && <RemoteAudio stream={stream} name={player.name} />}
      {isYou && !!holeCards?.length && (
        // covers the picture; the cards straddle its right edge, half on the picture and half beside it
        <div className="seat__mine-anchor">
          <span className="seat__mine">
            {holeCards.map((c, i) => (
              <PlayingCard key={c + i} card={c} size="sm" dim={player.folded} highlight={!!winner?.cards.includes(c)} />
            ))}
          </span>
        </div>
      )}
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
