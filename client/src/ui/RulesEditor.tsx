import { Plus, Trash2 } from 'lucide-react';
import type { RuleSet } from '../../../shared/types';
import { formatChips, ladder, payoutAmounts } from '../../../shared/presets';

interface Props {
  value: RuleSet;
  onChange: (r: RuleSet) => void;
  /** Level currently being played, to mark it in the structure. */
  currentLevel?: number;
}

function Num({ label, value, onChange, hint, min = 0, suffix }: { label: string; value: number; onChange: (n: number) => void; hint?: string; min?: number; suffix?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <input
          inputMode="numeric"
          value={Number.isFinite(value) ? String(value) : ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d-]/g, '');
            onChange(raw === '' || raw === '-' ? 0 : Math.max(min, Number(raw)));
          }}
        />
        {suffix && <span className="field__suffix">{suffix}</span>}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      {label}
    </label>
  );
}

export function RulesEditor({ value: r, onChange, currentLevel }: Props) {
  const set = (patch: Partial<RuleSet>) => onChange({ ...r, ...patch });
  const setLevel = (i: number, key: 'sb' | 'bb' | 'ante', v: number) => {
    const levels = r.levels.map((l, j) => (j === i ? { ...l, [key]: v, ...(key === 'sb' && l.bb === l.sb * 2 ? { bb: v * 2 } : {}) } : l));
    set({ levels });
  };
  const tourney = r.levelMinutes > 0;
  const rebuyWhen = r.rebuy.maxStackToRebuy === -1 ? 'any' : r.rebuy.maxStackToRebuy === 0 ? 'bust' : 'below';

  return (
    <div className="rules">
      <div className="rules__grid">
        <label className="field field--wide">
          <span className="field__label">Rule set name</span>
          <input value={r.name} onChange={(e) => set({ name: e.target.value.slice(0, 60) })} />
        </label>
        <Num label="Starting stack" value={r.startingStack} min={1} onChange={(n) => set({ startingStack: n })} hint={tourney ? 'Everyone buys in for this.' : 'Suggested buy-in. Players can choose.'} />
        <Num label="Blinds go up every" value={r.levelMinutes} onChange={(n) => set({ levelMinutes: Math.min(240, n) })} suffix="min" hint="0 keeps the blinds fixed (cash game)." />
        <Num label="Time to act" value={r.turnSeconds} onChange={(n) => set({ turnSeconds: Math.min(600, n) })} suffix="sec" hint="0 turns the shot clock off." />
      </div>

      <fieldset className="rules__section">
        <legend>Blind structure</legend>
        <div className="levels" role="table" aria-label="Blind levels">
          <div className="levels__head" role="row">
            <span role="columnheader">Level</span>
            <span role="columnheader">Small</span>
            <span role="columnheader">Big</span>
            <span role="columnheader">Ante</span>
            <span role="columnheader"><span className="sr-only">Remove</span></span>
          </div>
          {(tourney ? r.levels : r.levels.slice(0, 1)).map((l, i) => (
            <div className={`levels__row ${currentLevel === i ? 'is-current' : ''}`} role="row" key={i}>
              <span className="levels__no" role="cell">{i + 1}</span>
              <input role="cell" inputMode="numeric" aria-label={`Level ${i + 1} small blind`} value={l.sb} onChange={(e) => setLevel(i, 'sb', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <input role="cell" inputMode="numeric" aria-label={`Level ${i + 1} big blind`} value={l.bb} onChange={(e) => setLevel(i, 'bb', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <input role="cell" inputMode="numeric" aria-label={`Level ${i + 1} ante`} value={l.ante} onChange={(e) => setLevel(i, 'ante', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <button
                type="button"
                role="cell"
                className="iconbtn iconbtn--sm"
                aria-label={`Remove level ${i + 1}`}
                disabled={r.levels.length <= 1}
                onClick={() => set({ levels: r.levels.filter((_, j) => j !== i) })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        {tourney && (
          <div className="rules__row">
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => {
                const last = r.levels[r.levels.length - 1];
                set({ levels: [...r.levels, { sb: last.sb * 2, bb: last.bb * 2, ante: last.ante * 2 }] });
              }}
            >
              <Plus size={14} /> Add level
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => set({ levels: ladder(r.levels[0]?.sb || 25, 16, r.levels.some((l) => l.ante) ? 6 : 0) })}
            >
              Rebuild ladder from level 1
            </button>
            <span className="rules__note">The last level has no clock: its blinds stay until the game ends.</span>
          </div>
        )}
        {tourney && (
          <div className="rules__grid">
            <Num label="Break after every" value={r.breakEveryLevels} onChange={(n) => set({ breakEveryLevels: Math.min(60, n) })} suffix="levels" hint="0 means no breaks." />
            <Num label="Break length" value={r.breakMinutes} onChange={(n) => set({ breakMinutes: Math.min(60, n) })} suffix="min" />
          </div>
        )}
      </fieldset>

      {r.turnSeconds > 0 && (
        <fieldset className="rules__section">
          <legend>Time bank</legend>
          <Switch label="Give players a time bank" checked={r.timeBank.enabled} onChange={(v) => set({ timeBank: { ...r.timeBank, enabled: v } })} />
          {r.timeBank.enabled && (
            <div className="rules__grid">
              <Num label="Starting bank" value={r.timeBank.startSeconds} suffix="sec" onChange={(n) => set({ timeBank: { ...r.timeBank, startSeconds: Math.min(3600, n) } })} />
              <Num label="Top up with" value={r.timeBank.addSeconds} suffix="sec" onChange={(n) => set({ timeBank: { ...r.timeBank, addSeconds: Math.min(3600, n) } })} />
              <Num label="Every" value={r.timeBank.everyHands} suffix="hands" onChange={(n) => set({ timeBank: { ...r.timeBank, everyHands: Math.min(1000, n) } })} hint="0 never tops up." />
              <Num label="Bank can hold up to" value={r.timeBank.maxSeconds} suffix="sec" onChange={(n) => set({ timeBank: { ...r.timeBank, maxSeconds: Math.min(3600, n) } })} />
            </div>
          )}
          <span className="field__hint">When the {r.turnSeconds}s run out, the bank kicks in automatically. Whatever is used is gone until the next top-up.</span>
        </fieldset>
      )}

      <fieldset className="rules__section">
        <legend>Rabbit hunt</legend>
        <Switch label="Allow rabbit hunts" checked={r.rabbitHunt} onChange={(rabbitHunt) => set({ rabbitHunt })} />
        <span className="field__hint">After a fold ends the hand, a player can reveal the remaining community cards to everyone.</span>
      </fieldset>

      <fieldset className="rules__section">
        <legend>Leaving the table</legend>
        <Switch label="Players can cash out when they leave" checked={r.cashOut} onChange={(v) => set({ cashOut: v })} />
        <span className="field__hint">
          {r.cashOut
            ? 'Leaving pays out the stack in the ledger (cash game).'
            : 'Once the game starts, leaving takes the chips out of play. Players can still sit out.'}
        </span>
      </fieldset>

      <fieldset className="rules__section">
        <legend>Rebuys</legend>
        <Switch label="Allow rebuys" checked={r.rebuy.enabled} onChange={(v) => set({ rebuy: { ...r.rebuy, enabled: v } })} />
        {r.rebuy.enabled && (
          <div className="rules__grid">
            <Num label="Rebuy amount" value={r.rebuy.amount} onChange={(n) => set({ rebuy: { ...r.rebuy, amount: n } })} hint={r.rebuy.amount ? `Each rebuy adds ${formatChips(r.rebuy.amount)}.` : '0 lets the player choose.'} />
            <Num label="Rebuy period after start" value={r.rebuy.untilMinutes} suffix="min" onChange={(n) => set({ rebuy: { ...r.rebuy, untilMinutes: Math.min(1440, n) } })} hint="Play time, pauses don't count. 0 means no time limit." />
            {tourney && (
              <Num label="Or through level" value={r.rebuy.untilLevel} onChange={(n) => set({ rebuy: { ...r.rebuy, untilLevel: Math.min(60, n) } })} hint="0 means no level limit." />
            )}
            <Num label="Max rebuys per player" value={r.rebuy.maxPerPlayer} onChange={(n) => set({ rebuy: { ...r.rebuy, maxPerPlayer: Math.min(100, n) } })} hint="0 means unlimited." />
            <label className="field">
              <span className="field__label">Who can rebuy</span>
              <select
                value={rebuyWhen}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ rebuy: { ...r.rebuy, maxStackToRebuy: v === 'any' ? -1 : v === 'bust' ? 0 : Math.max(1, r.startingStack) } });
                }}
              >
                <option value="bust">Only when out of chips</option>
                <option value="below">At or below a stack size</option>
                <option value="any">Anyone, between hands</option>
              </select>
            </label>
            {rebuyWhen === 'below' && (
              <Num label="Rebuy allowed at or below" value={r.rebuy.maxStackToRebuy} min={1} onChange={(n) => set({ rebuy: { ...r.rebuy, maxStackToRebuy: Math.max(1, n) } })} />
            )}
          </div>
        )}
      </fieldset>

      {tourney && (
        <fieldset className="rules__section">
          <legend>Add-on</legend>
          <Switch label="Offer an add-on" checked={r.addOn.enabled} onChange={(v) => set({ addOn: { ...r.addOn, enabled: v } })} />
          {r.addOn.enabled && (
            <div className="rules__grid">
              <Num label="Add-on amount" value={r.addOn.amount} onChange={(n) => set({ addOn: { ...r.addOn, amount: n } })} />
              <Num label="Available in level" value={r.addOn.atLevel} onChange={(n) => set({ addOn: { ...r.addOn, atLevel: Math.min(60, n) } })} hint="Open during that level and the next. One per player." />
            </div>
          )}
        </fieldset>
      )}
      <fieldset className="rules__section">
        <legend>Settlement</legend>
        <Switch label="Work out the money after the game" checked={r.payout.enabled} onChange={(v) => set({ payout: { ...r.payout, enabled: v } })} />
        {r.payout.enabled && (
          <>
            <div className="rules__grid">
              <Num label="Buy-in" value={r.payout.buyIn} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, buyIn: n } })} />
              <Num label="Rebuy costs" value={r.payout.rebuy} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, rebuy: n } })} />
              {r.addOn.enabled && <Num label="Add-on costs" value={r.payout.addOn} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, addOn: n } })} />}
              <Num label="Places sharing rebuys" value={r.payout.places} min={1} onChange={(n) => set({ payout: { ...r.payout, places: Math.max(1, Math.min(9, n)) } })} />
              <label className="field">
                <span className="field__label">Currency</span>
                <input value={r.payout.currency} maxLength={6} onChange={(e) => set({ payout: { ...r.payout, currency: e.target.value } })} />
              </label>
            </div>
            <PayoutExample r={r} />
          </>
        )}
      </fieldset>
    </div>
  );
}

/** Worked example of the rotation, so the host can check it matches the house rules. */
function PayoutExample({ r }: { r: RuleSet }) {
  const p = r.payout;
  const players = 6;
  const rebuys = Math.max(p.places + 1, 4);
  const amounts = payoutAmounts(players, Array(rebuys).fill('rebuy'), p, players);
  const who = (place: number) => Array.from({ length: rebuys }, (_, i) => i).filter((i) => i % amounts.length === place - 1).map((i) => `#${i + 1}`);
  return (
    <div className="payout-ex">
      <span className="field__hint">
        Buy-ins all go to 1st place. Rebuys rotate in the order they are made. With no rebuys the winner takes everything.
        Example: {players} players, {rebuys} rebuys = {formatChips(players * p.buyIn + rebuys * p.rebuy)} {p.currency}
      </span>
      <ol className="settle__places">
        {amounts.map((a, i) => (
          <li key={i}>
            <span className="settle__place">{i + 1}</span>
            <span className="settle__who">{i === 0 ? `All buy-ins + rebuy ${who(1).join(', ')}` : `Rebuy ${who(i + 1).join(', ') || '—'}`}</span>
            <span className="settle__prize">{formatChips(a)} {p.currency}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
