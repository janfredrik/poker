import { useState } from 'react';
import type { RuleSet } from '../../shared/types';
import { BUILT_IN_RULESETS } from '../../shared/presets';
import { call, prefs, tokens } from './lib/socket';
import { RulesPicker } from './ui/RulesPicker';

export function Lobby({ navigate }: { navigate: (path: string) => void }) {
  const [name, setName] = useState(prefs.get('name'));
  const [tableName, setTableName] = useState(prefs.get('tableName', 'Friday game'));
  const [rules, setRules] = useState<RuleSet>(structuredClone(BUILT_IN_RULESETS.find((r) => r.id === 'friday-300') ?? BUILT_IN_RULESETS[0]));
  const [approval, setApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Enter your name so friends know who is hosting.'); return; }
    setBusy(true);
    try {
      const res = await call<{ tableId: string; token: string }>('table:create', {
        hostName: name, settings: { name: tableName, requireApproval: approval, rules },
      });
      prefs.set('name', name.trim());
      prefs.set('tableName', tableName.trim());
      tokens.set(res.tableId, res.token);
      navigate(`/t/${res.tableId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="lobby">
      <div className="lobby__lamp" aria-hidden="true" />
      <a className="wordmark lobby__mast" href="/">Home Game</a>
      <header className="lobby__head">
        <h1 className="lobby__title">Deal a table for tonight</h1>
        <p className="lobby__lede">No-limit Texas Hold'em on your own server. Set the rules, share the link, and see everyone's face at the table.</p>
      </header>

      <form className="lobby__card" onSubmit={create}>
        <div className="lobby__row">
          <label className="field">
            <span className="field__label">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18} autoComplete="nickname" autoFocus={!name} placeholder="Jani" />
          </label>
          <label className="field">
            <span className="field__label">Table name</span>
            <input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={40} />
          </label>
        </div>

        <RulesPicker value={rules} onChange={setRules} />

        <label className="toggle">
          <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          <span className="toggle__track" aria-hidden="true" />
          I approve each player before they sit down
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="lobby__submit">
          <button className="btn btn--act btn--lg" disabled={busy}>{busy ? 'Opening table…' : 'Open the table'}</button>
          <span className="lobby__hint">You get an invite link on the next screen.</span>
        </div>
      </form>
    </main>
  );
}
