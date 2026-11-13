import { useEffect, useMemo, useRef, useState } from 'react';
import type { TableView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { PlayingCard } from './Card';
import { ReactionPicker } from './Reactions';

interface Props {
  view: TableView;
  onAction: (type: string, amount?: number) => void;
  onRebuy: () => void;
  onAddOn: () => void;
  onSitOut: (v: boolean) => void;
  onShow: () => void;
  busy: boolean;
  canReact: boolean;
}

export function Dock({ view, onAction, onRebuy, onAddOn, onSitOut, onShow, busy, canReact }: Props) {
  const { you, hand } = view;
  const me = view.players.find((p) => p.id === you.playerId);
  const legal = you.legal;
  const actingName = hand?.toActId ? view.players.find((p) => p.id === hand.toActId)?.name : null;

  const totalPot = useMemo(() => (hand ? hand.potTotal + view.players.reduce((s, p) => s + p.bet, 0) : 0), [hand, view.players]);
  const [raiseTo, setRaiseTo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (legal?.canRaise) setRaiseTo(legal.minRaiseTo);
  }, [legal?.canRaise, legal?.minRaiseTo, hand?.number, hand?.street]);

  const potRaise = (frac: number) => {
    if (!legal || !hand) return 0;
    const afterCall = totalPot + legal.callAmount;
    return Math.round(hand.currentBet + afterCall * frac);
  };
  const clamp = (v: number) => (legal ? Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(v))) : v);

  // keyboard shortcuts while it's your turn
  useEffect(() => {
    if (!legal) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); onAction(legal.canCheck ? 'check' : 'fold'); }
      else if (k === 'c') { e.preventDefault(); onAction(legal.canCheck ? 'check' : 'call'); }
      else if (k === 'r' && legal.canRaise) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [legal, onAction]);

  const seated = me?.status === 'seated';
  const myTurn = !!legal;
  const rebuy = you.rebuy;
  const canShow = !!hand?.winners && me?.inHand && !me?.shownCards && you.holeCards.length > 0;
  const isBet = hand?.currentBet === 0;
  const allInRaise = legal && raiseTo >= legal.maxRaiseTo;

  return (
    <section className={`dock ${myTurn ? 'is-turn' : ''}`} aria-label="Your hand and actions">
      <div className="dock__hand">
        {you.holeCards.length ? (
          you.holeCards.map((c, i) => (
            <PlayingCard key={c + i} card={c} size="lg" dim={me?.folded} highlight={!!hand?.winners?.some((w) => w.playerId === me?.id && w.cards.includes(c))} delay={i * 90} />
          ))
        ) : (
          <>
            <PlayingCard empty size="lg" />
            <PlayingCard empty size="lg" />
          </>
        )}
      </div>

      <div className="dock__status">
        {myTurn ? (
          <>
            <span className="dock__label">
              {legal!.canCheck ? 'Your turn' : 'To call'}
              {hand?.usingBank ? ' · on your time bank' : view.settings.rules.timeBank.enabled && me ? ` · bank ${Math.round(me.timeBankMs / 1000)}s` : ''}
            </span>
            <span className="dock__big">{legal!.canCheck ? 'Check or bet' : formatChips(legal!.callAmount)}</span>
          </>
        ) : !seated ? (
          <>
            <span className="dock__label">{me?.status === 'pending' ? 'Request sent' : 'Watching'}</span>
            <span className="dock__mid">{me?.status === 'pending' ? 'The host will seat you shortly' : 'Pick an open seat to play'}</span>
          </>
        ) : me?.folded ? (
          <>
            <span className="dock__label">Folded</span>
            <span className="dock__mid">{actingName ? `${actingName} to act` : 'Next hand soon'}</span>
          </>
        ) : hand && !hand.winners && actingName ? (
          <>
            <span className="dock__label">Waiting</span>
            <span className="dock__mid">{actingName} to act</span>
          </>
        ) : (
          <>
            <span className="dock__label">Stack</span>
            <span className="dock__mid">{formatChips(me?.stack ?? 0)}</span>
          </>
        )}
        {seated && canReact && <ReactionPicker />}
      </div>

      <div className="dock__actions">
        {myTurn ? (
          <>
            {legal!.canRaise && (
              <div className="raise">
                <div className="raise__presets" role="group" aria-label="Raise presets">
                  <button className="chipbtn" onClick={() => setRaiseTo(legal!.minRaiseTo)}>Min</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(0.5)))}>½ pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(0.75)))}>¾ pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(1)))}>Pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(legal!.maxRaiseTo)}>All-in</button>
                </div>
                <div className="raise__row">
                  <input
                    type="range"
                    className="raise__slider"
                    min={legal!.minRaiseTo}
                    max={legal!.maxRaiseTo}
                    step={Math.max(1, view.hand?.blinds.sb ?? 1)}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(clamp(Number(e.target.value)))}
                    aria-label={isBet ? 'Bet amount' : 'Raise to'}
                  />
                  <input
                    ref={inputRef}
                    className="raise__input"
                    inputMode="numeric"
                    value={raiseTo || ''}
                    onChange={(e) => setRaiseTo(Number(e.target.value.replace(/\D/g, '')) || 0)}
                    onBlur={() => setRaiseTo(clamp(raiseTo))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAction('raise', clamp(raiseTo)); } }}
                    aria-label="Amount"
                  />
                </div>
              </div>
            )}
            <div className="dock__buttons">
              <button className="btn btn--fold" disabled={busy} onClick={() => onAction('fold')}>
                Fold <kbd>F</kbd>
              </button>
              <button className="btn btn--act" disabled={busy} onClick={() => onAction(legal!.canCheck ? 'check' : 'call')}>
                {legal!.canCheck ? 'Check' : legal!.callAmount >= (me?.stack ?? 0) ? `All-in ${formatChips(legal!.callAmount)}` : `Call ${formatChips(legal!.callAmount)}`}
                <kbd>C</kbd>
              </button>
              {legal!.canRaise && (
                <button className="btn btn--act btn--raise" disabled={busy || raiseTo < legal!.minRaiseTo && raiseTo < legal!.maxRaiseTo} onClick={() => onAction('raise', clamp(raiseTo))}>
                  {allInRaise ? 'All-in' : isBet ? 'Bet' : 'Raise to'} {formatChips(clamp(raiseTo))}
                  <kbd>R</kbd>
                </button>
              )}
            </div>
          </>
        ) : seated ? (
          <div className="dock__side">
            {view.settings.rules.timeBank.enabled && me && (
              <span className="dock__note">Time bank {Math.round(me.timeBankMs / 1000)}s</span>
            )}
            {canShow && <button className="btn btn--quiet" onClick={onShow}>Show cards</button>}
            {rebuy?.allowed && <button className="btn btn--act" onClick={onRebuy}>Rebuy{rebuy.amount ? ` ${formatChips(rebuy.amount)}` : ''}</button>}
            {rebuy?.addOnAllowed && <button className="btn btn--act" onClick={onAddOn}>Add-on {formatChips(rebuy.addOnAmount)}</button>}
            {!rebuy?.allowed && me && me.stack === 0 && rebuy?.reason && <span className="dock__note">{rebuy.reason}</span>}
            <label className="toggle">
              <input type="checkbox" checked={!!me?.sittingOut} onChange={(e) => onSitOut(e.target.checked)} />
              <span className="toggle__track" aria-hidden="true" />
              Sit out
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
