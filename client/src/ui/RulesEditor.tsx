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
          <span className="field__label">Navn på regelsett</span>
          <input value={r.name} onChange={(e) => set({ name: e.target.value.slice(0, 60) })} />
        </label>
        <Num label="Startstack" value={r.startingStack} min={1} onChange={(n) => set({ startingStack: n })} hint={tourney ? '' : 'Foreslått buy-in. Spillerne kan velge beløp selv.'} />
        <Num label="Tid per blindnivå" value={r.levelMinutes} onChange={(n) => set({ levelMinutes: Math.min(240, n) })} suffix="min" hint="Velg 0 for faste blinds (cash game)." />
        <Num label="Tid per tur" value={r.turnSeconds} onChange={(n) => set({ turnSeconds: Math.min(600, n) })} suffix="s" hint="Velg 0 for å slå av shot clock." />
      </div>

      <fieldset className="rules__section">
        <legend>Blindstruktur</legend>
        <div className="levels" role="table" aria-label="Blindnivåer">
          <div className="levels__head" role="row">
            <span role="columnheader">Nivå</span>
            <span role="columnheader">SB</span>
            <span role="columnheader">BB</span>
            <span role="columnheader">Ante</span>
            <span role="columnheader"><span className="sr-only">Fjern</span></span>
          </div>
          {(tourney ? r.levels : r.levels.slice(0, 1)).map((l, i) => (
            <div className={`levels__row ${currentLevel === i ? 'is-current' : ''}`} role="row" key={i}>
              <span className="levels__no" role="cell">{i + 1}</span>
              <input role="cell" inputMode="numeric" aria-label={`Small blind på nivå ${i + 1}`} value={l.sb} onChange={(e) => setLevel(i, 'sb', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <input role="cell" inputMode="numeric" aria-label={`Big blind på nivå ${i + 1}`} value={l.bb} onChange={(e) => setLevel(i, 'bb', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <input role="cell" inputMode="numeric" aria-label={`Ante på nivå ${i + 1}`} value={l.ante} onChange={(e) => setLevel(i, 'ante', Number(e.target.value.replace(/\D/g, '')) || 0)} />
              <button
                type="button"
                role="cell"
                className="iconbtn iconbtn--sm"
                aria-label={`Fjern nivå ${i + 1}`}
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
              <Plus size={14} /> Legg til nivå
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => set({ levels: ladder(r.levels[0]?.sb || 25, 16, r.levels.some((l) => l.ante) ? 6 : 0) })}
            >
              Bygg blindstrukturen på nytt fra nivå 1
            </button>
            <span className="rules__note">Siste nivå varer til spillet er over. Blinds øker ikke mer.</span>
          </div>
        )}
        {tourney && (
          <div className="rules__grid">
            <Num label="Antall nivåer mellom pauser" value={r.breakEveryLevels} onChange={(n) => set({ breakEveryLevels: Math.min(60, n) })} suffix="nivåer" hint="Velg 0 for å spille uten pauser." />
            <Num label="Pauselengde" value={r.breakMinutes} onChange={(n) => set({ breakMinutes: Math.min(60, n) })} suffix="min" />
          </div>
        )}
      </fieldset>

      {r.turnSeconds > 0 && (
        <fieldset className="rules__section">
          <legend>Tidsbank</legend>
          <Switch label="Gi spillerne en tidsbank" checked={r.timeBank.enabled} onChange={(v) => set({ timeBank: { ...r.timeBank, enabled: v } })} />
          {r.timeBank.enabled && (
            <div className="rules__grid">
              <Num label="Tid ved start" value={r.timeBank.startSeconds} suffix="s" onChange={(n) => set({ timeBank: { ...r.timeBank, startSeconds: Math.min(3600, n) } })} />
              <Num label="Ekstra tid per påfyll" value={r.timeBank.addSeconds} suffix="s" onChange={(n) => set({ timeBank: { ...r.timeBank, addSeconds: Math.min(3600, n) } })} />
              <Num label="Hender mellom påfyll" value={r.timeBank.everyHands} suffix="hender" onChange={(n) => set({ timeBank: { ...r.timeBank, everyHands: Math.min(1000, n) } })} hint="Velg 0 for å slå av påfyll." />
              <Num label="Maksimal tid i tidsbanken" value={r.timeBank.maxSeconds} suffix="s" onChange={(n) => set({ timeBank: { ...r.timeBank, maxSeconds: Math.min(3600, n) } })} />
            </div>
          )}
          <span className="field__hint">Etter {r.turnSeconds} sekunder bruker du automatisk tid fra tidsbanken. Tiden du bruker, trekkes fra saldoen.</span>
        </fieldset>
      )}

      <fieldset className="rules__section">
        <legend>Rabbit hunt</legend>
        <Switch label="Tillat rabbit hunt" checked={r.rabbitHunt} onChange={(rabbitHunt) => set({ rabbitHunt })} />
        <span className="field__hint">Når en fold avslutter hånden, kan en spiller vise alle hvilke felleskort som ville ha kommet.</span>
      </fieldset>

      <fieldset className="rules__section">
        <legend>Når noen forlater bordet</legend>
        <Switch label="Tillat cash-out når en spiller forlater bordet" checked={r.cashOut} onChange={(v) => set({ cashOut: v })} />
        <span className="field__hint">
          {r.cashOut
            ? 'Når en spiller går, føres resten av stacken som cash-out i regnskapet (cash game).'
            : 'Hvis en spiller forlater bordet etter spillstart, tas spillerens chips ut av spill. Spilleren kan også stå over hender.'}
        </span>
      </fieldset>

      <fieldset className="rules__section">
        <legend>Rebuys</legend>
        <Switch label="Tillat rebuys" checked={r.rebuy.enabled} onChange={(v) => set({ rebuy: { ...r.rebuy, enabled: v } })} />
        {r.rebuy.enabled && (
          <div className="rules__grid">
            <Num label="Chips per rebuy" value={r.rebuy.amount} onChange={(n) => set({ rebuy: { ...r.rebuy, amount: n } })} hint={r.rebuy.amount ? `Hver rebuy gir ${formatChips(r.rebuy.amount)} chips.` : 'Velg 0 for å la spilleren velge beløpet.'} />
            <Num label="Rebuy-periode fra spillstart" value={r.rebuy.untilMinutes} suffix="min" onChange={(n) => set({ rebuy: { ...r.rebuy, untilMinutes: Math.min(1440, n) } })} hint="Bare spilletid teller. Velg 0 for ubegrenset tid." />
            {tourney && (
              <Num label="Eller til og med nivå" value={r.rebuy.untilLevel} onChange={(n) => set({ rebuy: { ...r.rebuy, untilLevel: Math.min(60, n) } })} hint="Velg 0 for å tillate rebuys på alle nivåer." />
            )}
            <Num label="Maks rebuys per spiller" value={r.rebuy.maxPerPlayer} onChange={(n) => set({ rebuy: { ...r.rebuy, maxPerPlayer: Math.min(100, n) } })} hint="Velg 0 for ubegrenset antall." />
            <label className="field">
              <span className="field__label">Hvem kan gjøre rebuy?</span>
              <select
                value={rebuyWhen}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ rebuy: { ...r.rebuy, maxStackToRebuy: v === 'any' ? -1 : v === 'bust' ? 0 : Math.max(1, r.startingStack) } });
                }}
              >
                <option value="bust">Bare spillere uten chips</option>
                <option value="below">Spillere med stack på eller under en grense</option>
                <option value="any">Alle, mellom hender</option>
              </select>
            </label>
            {rebuyWhen === 'below' && (
              <Num label="Største stack som tillater rebuy" value={r.rebuy.maxStackToRebuy} min={1} onChange={(n) => set({ rebuy: { ...r.rebuy, maxStackToRebuy: Math.max(1, n) } })} />
            )}
          </div>
        )}
      </fieldset>

      {tourney && (
        <fieldset className="rules__section">
          <legend>Add-on</legend>
          <Switch label="Tilby add-on" checked={r.addOn.enabled} onChange={(v) => set({ addOn: { ...r.addOn, enabled: v } })} />
          {r.addOn.enabled && (
            <div className="rules__grid">
              <Num label="Chips per add-on" value={r.addOn.amount} onChange={(n) => set({ addOn: { ...r.addOn, amount: n } })} />
              <Num label="Tilgjengelig fra nivå" value={r.addOn.atLevel} onChange={(n) => set({ addOn: { ...r.addOn, atLevel: Math.min(60, n) } })} hint="Gjelder på dette nivået og det neste. Én add-on per spiller." />
            </div>
          )}
        </fieldset>
      )}
      <fieldset className="rules__section">
        <legend>Oppgjør</legend>
        <Switch label="Beregn oppgjøret etter spillet" checked={r.payout.enabled} onChange={(v) => set({ payout: { ...r.payout, enabled: v } })} />
        {r.payout.enabled && (
          <>
            <div className="rules__grid">
              <Num label="Buy-in" value={r.payout.buyIn} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, buyIn: n } })} />
              <Num label="Pris per rebuy" value={r.payout.rebuy} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, rebuy: n } })} />
              {r.addOn.enabled && <Num label="Pris per add-on" value={r.payout.addOn} suffix={r.payout.currency} onChange={(n) => set({ payout: { ...r.payout, addOn: n } })} />}
              <Num label="Antall premieplasser som deler rebuys" value={r.payout.places} min={1} onChange={(n) => set({ payout: { ...r.payout, places: Math.max(1, Math.min(9, n)) } })} />
              <label className="field">
                <span className="field__label">Valuta</span>
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
        Alle buy-ins går til vinneren. Rebuys fordeles på premieplassene i rekkefølge, med førsteplass først. Uten rebuys får vinneren hele premiepotten.
        Med {players} spillere og {rebuys} rebuys blir premiepotten {formatChips(players * p.buyIn + rebuys * p.rebuy)} {p.currency}
      </span>
      <ol className="settle__places">
        {amounts.map((a, i) => (
          <li key={i}>
            <span className="settle__place">{i + 1}</span>
            <span className="settle__who">{i === 0 ? `Alle buy-ins + rebuy ${who(1).join(', ')}` : `Rebuy ${who(i + 1).join(', ') || '—'}`}</span>
            <span className="settle__prize">{formatChips(a)} {p.currency}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
