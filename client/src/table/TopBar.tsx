import { Camera, CameraOff, Eye, Link2, Mic, MicOff, Pause, Play, PanelRight, Smartphone } from 'lucide-react';
import type { TableView } from '../../../shared/types';
import { formatChips, formatClock } from '../../../shared/presets';
import { useNow } from '../lib/media';
import { ThemePicker } from '../ui/ThemePicker';

interface Props {
  view: TableView;
  camOn: boolean;
  micOn: boolean;
  mediaBusy: boolean;
  canMedia: boolean;
  /** The camera runs on another screen (this is the phone after a handoff). */
  hideMedia?: boolean;
  onPhone?: () => void;
  onCam: () => void;
  onMic: () => void;
  onCopy: () => void;
  copied: boolean;
  onStart: () => void;
  onPause: () => void;
  drawerOpen: boolean;
  onDrawer: () => void;
  unread: number;
  watchers: number;
}

const blinds = (l: { sb: number; bb: number; ante: number }) => `${formatChips(l.sb)} / ${formatChips(l.bb)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''}`;

export function TopBar(p: Props) {
  const { view } = p;
  const c = view.clock;
  const timed = view.settings.rules.levelMinutes > 0;
  const now = useNow((timed && c.running) || (c.rebuyEndsInMs != null && view.status === 'running'), 500);
  const remaining = c.running ? Math.max(0, c.remainingMs - (now - c.at)) : c.remainingMs;
  const rebuyLeft = c.rebuyEndsInMs == null ? 0 : view.status === 'running' ? Math.max(0, c.rebuyEndsInMs - (now - c.at)) : c.rebuyEndsInMs;
  const frac = c.levelMs ? remaining / c.levelMs : 0;
  const isHost = view.you.isHost;
  const pendingCount = view.players.filter((x) => x.status === 'pending').length;

  return (
    <header className="topbar">
      <div className="topbar__id">
        <a className="wordmark wordmark--sm" href="/">Poker</a>
        <span className="topbar__table">{view.settings.name}</span>
      </div>

      <div className={`clock ${c.onBreak ? 'is-break' : ''} ${view.status === 'paused' ? 'is-paused' : ''}`} aria-live="polite">
        <div className="clock__now">
          <span className="clock__level">{c.onBreak ? 'Pause' : c.final ? `Nivå ${c.levelIndex + 1} · siste` : timed ? `Nivå ${c.levelIndex + 1}` : 'Blinds'}</span>
          <span className="clock__blinds">{blinds(c.level)}</span>
        </div>
        {timed && !c.final && (
          <div className="clock__time">
            <span className="clock__bar" aria-hidden="true"><span style={{ transform: `scaleX(${frac})` }} /></span>
            <span className="clock__meta">
              <span className="clock__remaining">{view.status === 'waiting' ? formatClock(c.levelMs) : formatClock(remaining)}</span>
              {c.next && <span className="clock__next">neste {blinds(c.next)}</span>}
            </span>
          </div>
        )}
        {view.status === 'paused' && <span className="clock__flag">På pause</span>}
        {view.status === 'finished' && <span className="clock__flag">Spillet er over</span>}
        {c.rebuyEndsInMs != null && (
          <span className={`clock__rebuy ${rebuyLeft === 0 ? 'is-closed' : ''}`}>
            {rebuyLeft === 0 ? 'Rebuy-perioden er over' : <>Rebuys <b>{formatClock(rebuyLeft)}</b></>}
          </span>
        )}
      </div>

      <div className="topbar__tools">
        {isHost && (view.status === 'waiting' || view.status === 'paused') && (
          <button className="btn btn--act btn--sm" onClick={p.onStart} disabled={view.status === 'waiting' && view.players.filter((x) => x.status === 'seated').length < 2}>
            <Play size={15} /> {view.status === 'paused' ? 'Fortsett' : 'Start spillet'}
          </button>
        )}
        {isHost && view.status === 'running' && (
          <button className="btn btn--quiet btn--sm" onClick={p.onPause}><Pause size={15} /> Pause</button>
        )}
        {p.watchers > 0 && (
          <span className="topbar__watchers" title={`${p.watchers} ${p.watchers === 1 ? 'person ser' : 'personer ser'} på uten å spille`}>
            <Eye size={15} aria-hidden="true" /> {p.watchers}<span className="sr-only"> ser på</span>
          </span>
        )}
        <button className="btn btn--quiet btn--sm" onClick={p.onCopy}>
          <Link2 size={15} /> {p.copied ? 'Lenken er kopiert' : 'Inviter'}
        </button>
        <span className="topbar__sep" aria-hidden="true" />
        <ThemePicker />
        {p.onPhone && (
          <button className="iconbtn" onClick={p.onPhone} title="Fortsett på mobilen">
            <Smartphone size={18} />
          </button>
        )}
        {!p.hideMedia && <>
        <button
          className={`iconbtn ${p.camOn ? 'is-on' : ''}`}
          onClick={p.onCam}
          disabled={!p.canMedia || p.mediaBusy}
          aria-pressed={p.camOn}
          title={p.canMedia ? (p.camOn ? 'Slå av kameraet' : 'Slå på kameraet') : 'Velg et sete for å bruke kameraet'}
        >
          {p.camOn ? <Camera size={18} /> : <CameraOff size={18} />}
        </button>
        <button
          className={`iconbtn ${p.micOn ? 'is-on' : ''}`}
          onClick={p.onMic}
          disabled={!p.canMedia || p.mediaBusy}
          aria-pressed={p.micOn}
          title={p.canMedia ? (p.micOn ? 'Slå av mikrofonen' : 'Slå på mikrofonen') : 'Velg et sete for å bruke mikrofonen'}
        >
          {p.micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        </>}
        <button className={`iconbtn ${p.drawerOpen ? 'is-on' : ''}`} onClick={p.onDrawer} aria-pressed={p.drawerOpen} title="Logg, chat, regnskap og innstillinger">
          <PanelRight size={18} />
          {(p.unread > 0 || (isHost && pendingCount > 0)) && !p.drawerOpen && <span className="dot" aria-label="Ny aktivitet" />}
        </button>
      </div>
    </header>
  );
}
