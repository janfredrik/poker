import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import type { RuleSet } from '../../../shared/types';
import { BUILT_IN_RULESETS, formatChips } from '../../../shared/presets';
import { RulesEditor } from './RulesEditor';

export function summarize(r: RuleSet): string {
  const l = r.levels[0];
  const blinds = `${formatChips(l.sb)}/${formatChips(l.bb)}`;
  const parts = [r.levelMinutes > 0 ? `${blinds} start, up every ${r.levelMinutes} min` : `${blinds} fixed`, `${formatChips(r.startingStack)} chips`];
  if (r.rebuy.enabled) {
    const lim = r.rebuy.maxPerPlayer ? `${r.rebuy.maxPerPlayer} rebuy${r.rebuy.maxPerPlayer > 1 ? 's' : ''}` : 'rebuys';
    parts.push(r.rebuy.untilMinutes ? `${lim} in the first ${r.rebuy.untilMinutes} min` : r.rebuy.untilLevel && r.levelMinutes > 0 ? `${lim} through level ${r.rebuy.untilLevel}` : lim);
  } else parts.push('no rebuys');
  if (r.turnSeconds) parts.push(`${r.turnSeconds}s to act`);
  if (r.timeBank.enabled && r.turnSeconds) parts.push(`${r.timeBank.startSeconds}s time bank`);
  if (r.payout.enabled) parts.push(`${formatChips(r.payout.buyIn)} ${r.payout.currency} buy-in`);
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

  const load = () => fetch('/api/rulesets').then((r) => r.json()).then(setSets).catch(() => {});
  useEffect(() => { void load(); }, []);

  const selected = sets.find((s) => s.id === value.id);
  const dirty = !selected || JSON.stringify({ ...selected, builtIn: false }) !== JSON.stringify({ ...value, builtIn: false });

  const save = async () => {
    setStatus(null);
    try {
      const res = await fetch('/api/rulesets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selected?.builtIn ? { ...value, id: '' } : value),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = (await res.json()) as RuleSet;
      await load();
      onChange(saved);
      setStatus(`Saved “${saved.name}”.`);
    } catch (e) {
      setStatus((e as Error).message || 'Could not save the rule set.');
    }
  };

  const remove = async () => {
    if (!selected || selected.builtIn) return;
    await fetch(`/api/rulesets/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    await load();
    onChange(BUILT_IN_RULESETS[0]);
    setStatus(`Deleted “${selected.name}”.`);
  };

  return (
    <div className="picker">
      <label className="field field--wide">
        <span className="field__label">Rule set</span>
        <select
          value={selected && !dirty ? value.id : '__edited'}
          onChange={(e) => { const s = sets.find((x) => x.id === e.target.value); if (s) { onChange(structuredClone(s)); setStatus(null); } }}
        >
          {(!selected || dirty) && <option value="__edited">{value.name} (edited)</option>}
          <optgroup label="Presets">
            {sets.filter((s) => s.builtIn).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
          {sets.some((s) => !s.builtIn) && (
            <optgroup label="Saved on this server">
              {sets.filter((s) => !s.builtIn).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
        <span className="field__hint">{summarize(value)}</span>
      </label>

      <div className="picker__bar">
        <button type="button" className="btn btn--quiet btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide rules' : 'Edit rules'}
        </button>
        {(dirty || open) && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={save}>
            <Save size={14} /> {selected && !selected.builtIn && !dirty ? 'Saved' : selected && !selected.builtIn ? 'Save changes' : 'Save as new rule set'}
          </button>
        )}
        {selected && !selected.builtIn && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={remove}><Trash2 size={14} /> Delete</button>
        )}
        {status && <span className="picker__status" role="status">{status}</span>}
      </div>

      {open && <RulesEditor value={value} onChange={(r) => { onChange(r); setStatus(null); }} currentLevel={currentLevel} />}
    </div>
  );
}
