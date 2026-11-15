import { useEffect, useId, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import type { RuleSet } from '../../../shared/types';
import { BUILT_IN_RULESETS, formatChips } from '../../../shared/presets';
import { prefs } from '../lib/socket';
import { RulesEditor } from './RulesEditor';

const errorText = (res: Response) => res.json().then((b: { error?: string }) => b.error ?? '', () => '');

export function summarize(r: RuleSet): string {
  const l = r.levels[0];
  const blinds = `${formatChips(l.sb)}/${formatChips(l.bb)}`;
  const parts = [r.levelMinutes > 0 ? `Blinds fra ${blinds}, ${r.levelMinutes} min per nivå` : `Faste blinds på ${blinds}`, `${formatChips(r.startingStack)} chips`];
  if (r.rebuy.enabled) {
    const lim = r.rebuy.maxPerPlayer ? `${r.rebuy.maxPerPlayer} rebuy${r.rebuy.maxPerPlayer > 1 ? 's' : ''}` : 'rebuys';
    parts.push(r.rebuy.untilMinutes ? `${lim} de første ${r.rebuy.untilMinutes} min` : r.rebuy.untilLevel && r.levelMinutes > 0 ? `${lim} til og med nivå ${r.rebuy.untilLevel}` : lim);
  } else parts.push('ingen rebuys');
  if (r.turnSeconds) parts.push(`${r.turnSeconds} s per tur`);
  if (r.rabbitHunt) parts.push('rabbit hunt');
  if (r.timeBank.enabled && r.turnSeconds) parts.push(`tidsbank på ${r.timeBank.startSeconds} s`);
  if (r.payout.enabled) parts.push(`buy-in på ${formatChips(r.payout.buyIn)} ${r.payout.currency}`);
  return parts.join(' · ');
}

interface Props {
  value: RuleSet;
  onChange: (r: RuleSet) => void;
  currentLevel?: number;
  startOpen?: boolean;
}

/** Choose a saved rule set, tweak it, and optionally save the tweak for next time. */
export function RulesPicker({ value, onChange, currentLevel, startOpen = false }: Props) {
  const [sets, setSets] = useState<RuleSet[]>(BUILT_IN_RULESETS);
  const [open, setOpen] = useState(startOpen);
  const [status, setStatus] = useState<string | null>(null);
  const selectId = useId();

  const load = () => fetch('/api/rulesets').then((r) => r.json()).then(setSets).catch(() => {});
  useEffect(() => { void load(); }, []);

  const selected = sets.find((s) => s.id === value.id);
  const dirty = !selected || JSON.stringify({ ...selected, builtIn: false }) !== JSON.stringify({ ...value, builtIn: false });

  const save = async () => {
    setStatus(null);
    try {
      const res = await fetch('/api/rulesets', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-create-code': prefs.get('createCode') },
        body: JSON.stringify(selected?.builtIn ? { ...value, id: '' } : value),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const saved = (await res.json()) as RuleSet;
      await load();
      onChange(saved);
      setStatus(`Lagret «${saved.name}».`);
    } catch (err) {
      setStatus((err as Error).message || 'Kunne ikke lagre regelsettet. Prøv igjen.');
    }
  };

  const remove = async () => {
    if (!selected || selected.builtIn) return;
    const res = await fetch(`/api/rulesets/${encodeURIComponent(selected.id)}`, { method: 'DELETE', headers: { 'x-create-code': prefs.get('createCode') } });
    if (!res.ok) { setStatus(await errorText(res) || 'Kunne ikke slette regelsettet.'); return; }
    await load();
    onChange(BUILT_IN_RULESETS[0]);
    setStatus(`Slettet «${selected.name}».`);
  };

  return (
    <div className="picker">
      <div className="field field--wide">
        <label className="field__label" htmlFor={selectId}>Regelsett</label>
        <div className="picker__row">
          <select
            id={selectId}
            value={selected && !dirty ? value.id : '__edited'}
            onChange={(e) => { const s = sets.find((x) => x.id === e.target.value); if (s) { onChange(structuredClone(s)); setStatus(null); } }}
          >
            {(!selected || dirty) && <option value="__edited">{value.name} (endret)</option>}
            <optgroup label="Forhåndsvalg">
              {sets.filter((s) => s.builtIn).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
            {sets.some((s) => !s.builtIn) && (
              <optgroup label="Lagret på denne serveren">
                {sets.filter((s) => !s.builtIn).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn btn--quiet picker__edit" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Skjul regler' : 'Rediger regler'}
          </button>
        </div>
        <span className="field__hint">{summarize(value)}</span>
      </div>

      {(dirty || open || (selected && !selected.builtIn) || status) && (
        <div className="picker__bar">
          {(dirty || open) && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={save}>
              <Save size={14} /> {selected && !selected.builtIn && !dirty ? 'Lagret' : selected && !selected.builtIn ? 'Lagre endringer' : 'Lagre som nytt regelsett'}
            </button>
          )}
          {selected && !selected.builtIn && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={remove}><Trash2 size={14} /> Slett</button>
          )}
          {status && <span className="picker__status" role="status">{status}</span>}
        </div>
      )}

      {open && <RulesEditor value={value} onChange={(r) => { onChange(r); setStatus(null); }} currentLevel={currentLevel} />}
    </div>
  );
}
