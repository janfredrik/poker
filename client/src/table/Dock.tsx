import { useEffect, useMemo, useRef, useState } from 'react';
import type { TableView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { PlayingCard } from './Card';
import { ReactionPicker } from './Reactions';
import { DealerTalkButton } from '../dealer/DealerTalkButton'; // AI-dealer

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
  // Folding when checking is free is almost always a misclick, so the Fold button asks for a second click.
  const [foldArmed, setFoldArmed] = useState(false);
  useEffect(() => {
    setFoldArmed(false);
  }, [legal?.canCheck, hand?.number, hand?.street]);
  useEffect(() => {
    if (!foldArmed) return;
    const t = setTimeout(() => setFoldArmed(false), 3000);
    return () => clearTimeout(t);
  }, [foldArmed]);
  const onFold = () => {
    if (legal?.canCheck && !foldArmed) { setFoldArmed(true); return; }
    setFoldArmed(false);
    onAction('fold');
  };

  // A choice made before your turn, acted on as soon as it comes. It only holds for the street it was
  // made on, and Check / Call lapse once someone bets more (so you never call an amount you didn't see).
  const [pre, setPre] = useState<{ kind: 'checkfold' | 'check' | 'call'; hand: number; street: string; bet: number } | null>(null);
  const preValid = !!pre && !!hand && pre.hand === hand.number && pre.street === hand.street
    && (pre.kind === 'checkfold' || pre.bet === hand.currentBet);
  const preKind = preValid ? pre!.kind : null;
  const toCall = hand && me ? Math.min(me.stack, Math.max(0, hand.currentBet - me.bet)) : 0;
  const togglePre = (kind: 'checkfold' | 'check' | 'call') => {
    if (!hand) return;
    setPre(preKind === kind ? null : { kind, hand: hand.number, street: hand.street, bet: hand.currentBet });
  };
  useEffect(() => {
    if (!legal || !pre) return;
    setPre(null);
    if (!preValid) return;
    if (pre.kind === 'checkfold') onAction(legal.canCheck ? 'check' : 'fold');
    else if (legal.canCheck) onAction('check');
    else if (pre.kind === 'call') onAction('call');
  }, [legal]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const bb = Math.max(1, hand?.blinds.bb ?? 1);
  const canPre = seated && !myTurn && !!hand && !hand.winners && !!me?.inHand && !me.folded && !me.allIn;

  return (
    <section className={`dock ${myTurn ? 'is-turn' : ''}`} aria-label="Din hånd og dine valg">
      <div className="dock__hand">
        <div className="dock__cards">
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
        {you.madeHand && (
          <span className={`dock__made ${me?.folded ? 'is-folded' : ''}`} aria-live="polite">
            {hand?.rabbitCards?.length ? `Du ville hatt ${you.madeHand}` : you.madeHand}
          </span>
        )}
      </div>

      <div className="dock__status">
        {myTurn ? (
          <>
            <span className="dock__label">
              {legal!.canCheck ? 'Din tur' : 'Beløp for call'}
              {hand?.usingBank ? ' · bruker tidsbanken' : view.settings.rules.timeBank.enabled && me ? ` · tidsbank ${Math.round(me.timeBankMs / 1000)} s` : ''}
            </span>
            <span className="dock__big">{legal!.canCheck ? 'Check eller bet' : formatChips(legal!.callAmount)}</span>
          </>
        ) : !seated ? (
          <>
            <span className="dock__label">{me?.status === 'pending' ? 'Forespørsel sendt' : 'Tilskuer'}</span>
            <span className="dock__mid">{me?.status === 'pending' ? 'Venter på godkjenning fra verten' : 'Velg et ledig sete for å spille'}</span>
          </>
        ) : me?.folded ? (
          <>
            <span className="dock__label">Fold</span>
            <span className="dock__mid">{actingName ? `${actingName} sin tur` : 'Neste hånd starter snart'}</span>
          </>
        ) : hand && !hand.winners && actingName ? (
          <>
            <span className="dock__label">{view.status === 'paused' ? 'På pause' : 'Venter'}</span>
            <span className="dock__mid">{hand.toActId === me?.id ? 'Din tur når spillet fortsetter' : `${actingName} sin tur`}</span>
          </>
        ) : (
          <>
            <span className="dock__label">Stack</span>
            <span className="dock__mid">{formatChips(me?.stack ?? 0)}</span>
          </>
        )}
        {seated && canReact && <ReactionPicker />}
        <DealerTalkButton view={view} />{/* AI-dealer */}
      </div>

      <div className="dock__actions">
        {myTurn ? (
          <>
            {legal!.canRaise && (
              <div className="raise">
                <div className="raise__presets" role="group" aria-label="Forhåndsvalg for raise">
                  <button className="chipbtn" onClick={() => setRaiseTo(legal!.minRaiseTo)}>Min</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(0.5)))}>½ pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(0.75)))}>¾ pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(clamp(potRaise(1)))}>Pot</button>
                  <button className="chipbtn" onClick={() => setRaiseTo(legal!.maxRaiseTo)}>All-in</button>
                </div>
                <div className="raise__row">
                  <button className="chipbtn raise__step" aria-label="Én big blind mindre" title="Én big blind mindre"
                    disabled={raiseTo <= legal!.minRaiseTo} onClick={() => setRaiseTo(clamp(raiseTo - bb))}>−</button>
                  <input
                    type="range"
                    className="raise__slider"
                    min={legal!.minRaiseTo}
                    max={legal!.maxRaiseTo}
                    step={Math.max(1, view.hand?.blinds.sb ?? 1)}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(clamp(Number(e.target.value)))}
                    aria-label={isBet ? 'Beløp for bet' : 'Raise til'}
                  />
                  <button className="chipbtn raise__step" aria-label="Én big blind mer" title="Én big blind mer"
                    disabled={raiseTo >= legal!.maxRaiseTo} onClick={() => setRaiseTo(clamp(raiseTo + bb))}>+</button>
                  <input
                    ref={inputRef}
                    className="raise__input"
                    inputMode="numeric"
                    value={raiseTo || ''}
                    onChange={(e) => setRaiseTo(Number(e.target.value.replace(/\D/g, '')) || 0)}
                    onBlur={() => setRaiseTo(clamp(raiseTo))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAction('raise', clamp(raiseTo)); } }}
                    aria-label="Beløp"
                  />
                </div>
              </div>
            )}
            <div className="dock__buttons">
              <button className={`btn btn--fold ${foldArmed ? 'is-armed' : ''}`} disabled={busy} onClick={onFold}
                title={legal!.canCheck ? 'Du kan checke gratis' : undefined}>
                {foldArmed ? 'Fold likevel?' : <>Fold <kbd>F</kbd></>}
              </button>
              <button className="btn btn--act" disabled={busy} onClick={() => onAction(legal!.canCheck ? 'check' : 'call')}>
                {legal!.canCheck ? 'Check' : legal!.callAmount >= (me?.stack ?? 0) ? `All-in ${formatChips(legal!.callAmount)}` : `Call ${formatChips(legal!.callAmount)}`}
                <kbd>C</kbd>
              </button>
              {legal!.canRaise && (
                <button className="btn btn--act btn--raise" disabled={busy || raiseTo < legal!.minRaiseTo && raiseTo < legal!.maxRaiseTo} onClick={() => onAction('raise', clamp(raiseTo))}>
                  {allInRaise ? 'All-in' : isBet ? 'Bet' : 'Raise til'} {formatChips(clamp(raiseTo))}
                  <kbd>R</kbd>
                </button>
              )}
            </div>
          </>
        ) : seated ? (
          <div className="dock__side">
            {canPre && (
              <div className="preact" role="group" aria-label="Velg før det er din tur">
                <label className={`chipbtn preact__opt ${preKind === 'checkfold' ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={preKind === 'checkfold'} onChange={() => togglePre('checkfold')} />
                  Check/fold
                </label>
                {toCall === 0 ? (
                  <label className={`chipbtn preact__opt ${preKind === 'check' ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={preKind === 'check'} onChange={() => togglePre('check')} />
                    Check
                  </label>
                ) : (
                  <label className={`chipbtn preact__opt ${preKind === 'call' ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={preKind === 'call'} onChange={() => togglePre('call')} />
                    {toCall >= (me?.stack ?? 0) ? `Call all-in ${formatChips(toCall)}` : `Call ${formatChips(toCall)}`}
                  </label>
                )}
              </div>
            )}
            {view.settings.rules.timeBank.enabled && me && (
              <span className="dock__note">Tidsbank {Math.round(me.timeBankMs / 1000)} s</span>
            )}
            {canShow && <button className="btn btn--quiet" onClick={onShow}>Vis kortene</button>}
            {rebuy?.allowed && <button className="btn btn--act" onClick={onRebuy}>Rebuy{rebuy.amount ? ` ${formatChips(rebuy.amount)}` : ''}</button>}
            {rebuy?.addOnAllowed && <button className="btn btn--act" onClick={onAddOn}>Add-on {formatChips(rebuy.addOnAmount)}</button>}
            {!rebuy?.allowed && me && me.stack === 0 && rebuy?.reason && <span className="dock__note">{rebuy.reason}</span>}
            <label className="toggle">
              <input type="checkbox" checked={!!me?.sittingOut} onChange={(e) => onSitOut(e.target.checked)} />
              <span className="toggle__track" aria-hidden="true" />
              Stå over
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
