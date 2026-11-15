// AI-dealer: the drawn dealer at the top of the table, her speech bubble and her voice.
import { useEffect, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';
import type { TableView } from '../../../shared/types';
import { socket } from '../lib/socket';
import { dealerMuted, useDealerInfo, type DealerSay } from './info';
import { useDealerVoice } from './useDealerVoice';
import './dealer.css';

export function DealerSeat({ view, tall }: { view: TableView; tall: boolean }) {
  const info = useDealerInfo();
  const on = info.available && !!view.settings.dealer;
  if (!on) return null;
  return <Dealer tall={tall} />;
}

function Dealer({ tall }: { tall: boolean }) {
  const [muted, setMuted] = useState(dealerMuted.get);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const voice = useDealerVoice();
  const [line, setLine] = useState<DealerSay | null>(null);

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout>;
    let latest = '';
    const receive = (msg: DealerSay) => {
      latest = msg.id;
      clearTimeout(hide);
      voice.stop();
      setLine(msg);
      const readMs = Math.max(3500, msg.text.length * 60 + 1800);
      const done = () => { if (latest === msg.id) hide = setTimeout(() => setLine(null), 1800); };
      if (msg.audioUrl && !mutedRef.current) {
        const fallback = setTimeout(() => setLine((l) => (l?.id === msg.id ? null : l)), readMs + 15000);
        void voice.play(msg.audioUrl).then((played) => {
          clearTimeout(fallback);
          if (played) done();
          else if (latest === msg.id) hide = setTimeout(() => setLine(null), readMs);
        });
      } else {
        hide = setTimeout(() => setLine(null), readMs);
      }
    };
    socket.on('dealer:say', receive);
    return () => { socket.off('dealer:say', receive); clearTimeout(hide); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    dealerMuted.set(next);
    if (next) voice.stop();
  };

  return (
    <div className={`dealer-anchor ${tall ? 'is-tall' : ''}`} style={{ left: '50%', top: tall ? '10%' : '16%' }}>
      <button
        className={`dealer ${voice.speaking ? 'is-speaking' : ''}`}
        onClick={toggleMute}
        aria-pressed={!muted}
        aria-label={muted ? 'Dealer, stemmen er av. Slå på stemmen.' : 'Dealer. Slå av stemmen for deg.'}
        title={muted ? 'Slå på dealerens stemme' : 'Slå av dealerens stemme for deg'}
      >
        <DealerFigure mouth={voice.mouth} />
        {muted && <span className="dealer__muted" aria-hidden="true"><VolumeX size={12} /></span>}
      </button>
      {!tall && <span className="dealer__plate" aria-hidden="true">Dealer</span>}
      <div className="dealer__say" role="status" aria-live="polite">
        {line && (
          <p key={line.id} className="dealer__bubble">
            {line.replyTo && <span className="dealer__to">Til {line.replyTo.name}</span>}
            <span className="sr-only">Dealeren sier: </span>{line.text}
          </p>
        )}
      </div>
    </div>
  );
}

/** Flat drawing in the table's palette: walnut hair, bone shirt, ink vest, felt bow tie. */
function DealerFigure({ mouth }: { mouth: 0 | 1 | 2 }) {
  return (
    <svg className="dealer__art" viewBox="0 0 120 90" aria-hidden="true">
      {/* hair behind the head */}
      <path d="M38 44c-2-20 9-31 22-31s24 11 22 31c-1 9 2 16 6 22H32c4-6 7-13 6-22z" fill="var(--walnut-950)" />
      {/* shoulders: ink vest over a bone shirt */}
      <path d="M22 90c2-14 12-21 26-23l12 8 12-8c14 2 24 9 26 23z" fill="var(--ink)" />
      <path d="M48 67l12 8 12-8-4-2-8 5-8-5z" fill="var(--bone)" />
      <path d="M60 75l-6 15h12z" fill="var(--bone)" />
      <path d="M52 72l8 4 8-4v7l-8-3-8 3z" fill="var(--felt-500)" />
      <circle cx="60" cy="76" r="1.8" fill="var(--felt-700)" />
      {/* neck and head */}
      <path d="M54 56h12v11l-6 4-6-4z" fill="var(--bone-2)" />
      <path d="M54 62q6 3 12 0v-2H54z" fill="var(--walnut-500)" opacity="0.35" />
      <ellipse cx="60" cy="41" rx="15" ry="18" fill="var(--bone-2)" />
      {/* bangs swept to one side */}
      <path d="M44 38c0-15 9-22 18-22 9 0 15 6 15 15-6-1-12-5-15-10-3 8-10 14-18 17z" fill="var(--walnut-950)" />
      {/* brows and eyes */}
      <path d="M50 36q4-2 7 0M63 36q4-2 7 0" stroke="var(--walnut-850)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <g className="dealer__eyes" fill="var(--ink)">
        <ellipse cx="53.5" cy="41" rx="1.7" ry="2.1" />
        <ellipse cx="66.5" cy="41" rx="1.7" ry="2.1" />
      </g>
      <path d="M60 43q-1 4 1 5" stroke="var(--walnut-500)" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* mouth: closed, half open, open */}
      {mouth === 0 && <path d="M55 51.5q5 2.5 10 0" stroke="var(--walnut-600)" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
      {mouth === 1 && <ellipse cx="60" cy="52" rx="4" ry="1.8" fill="var(--walnut-800)" stroke="var(--walnut-600)" strokeWidth="0.9" />}
      {mouth === 2 && <ellipse cx="60" cy="52.5" rx="4.4" ry="3.2" fill="var(--walnut-800)" stroke="var(--walnut-600)" strokeWidth="0.9" />}
      {/* small earrings in bone */}
      <circle cx="45.5" cy="47" r="1.2" fill="var(--bone)" />
      <circle cx="74.5" cy="47" r="1.2" fill="var(--bone)" />
    </svg>
  );
}
