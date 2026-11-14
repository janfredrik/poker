import { useState } from 'react';
import type { RuleSet } from '../../shared/types';
import { BUILT_IN_RULESETS } from '../../shared/presets';
import { call, prefs, tokens } from './lib/socket';
import { RulesPicker } from './ui/RulesPicker';
import { PlayingCard } from './table/Card';

export function Lobby({ navigate }: { navigate: (path: string) => void }) {
  const [name, setName] = useState(prefs.get('name'));
  const [tableName, setTableName] = useState(prefs.get('tableName', 'Friday game'));
  const [rules, setRules] = useState<RuleSet>(structuredClone(BUILT_IN_RULESETS.find((r) => r.id === 'friday-300') ?? BUILT_IN_RULESETS[0]));
  const [approval, setApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bots, setBots] = useState(3);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const demo = async () => {
    setDemoError(null);
    setDemoBusy(true);
    try {
      const res = await call<{ tableId: string; token: string }>('demo:create', { name: name.trim() || 'You', bots });
      if (name.trim()) prefs.set('name', name.trim());
      tokens.set(res.tableId, res.token);
      navigate(`/t/${res.tableId}`);
    } catch (err) {
      setDemoError((err as Error).message);
      setDemoBusy(false);
    }
  };

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
      <a className="wordmark lobby__mast" href="/">Poker</a>
      <a className="season__nav" href="/season">Season standings</a>
      <div className="lobby__stage">
        <div className="lobby__lamp" aria-hidden="true" />
        <header className="lobby__head">
          <h1 className="lobby__title">Deal a table <span>for tonight</span></h1>
          <p className="lobby__lede">Play poker with your friends. Set the rules, share the link, and see everyone's face at the table.</p>
        </header>

      <form className="lobby__card" onSubmit={create}>
        <div className="spread" aria-hidden="true">
          <span className="spread__card spread__card--a"><PlayingCard card="As" size="lg" /></span>
          <span className="spread__card spread__card--b"><PlayingCard card="Ah" size="lg" /></span>
          <span className="marker marker--dealer spread__button">D</span>
        </div>
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
          Players need my approval to join
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="lobby__submit">
          <button className="btn btn--act btn--lg" disabled={busy}>{busy ? 'Opening table…' : 'Open the table'}</button>
        </div>
      </form>

      <section className="demo" aria-labelledby="demo-title">
        <div className="demo__text">
          <h2 className="demo__title" id="demo-title">Just want to try it?</h2>
          <p className="demo__lede">Play a few hands against bots.</p>
        </div>
        <div className="demo__controls">
          <div className="demo__count" role="radiogroup" aria-label="Number of bots">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={bots === n} className={`demo__n ${bots === n ? 'is-on' : ''}`} onClick={() => setBots(n)}>{n}</button>
            ))}
          </div>
          <button type="button" className="btn btn--lg demo__go" disabled={demoBusy} onClick={() => void demo()}>
            {demoBusy ? 'Dealing…' : `Play against ${bots} bot${bots === 1 ? '' : 's'}`}
          </button>
        </div>
        {demoError && <p className="form-error" role="alert">{demoError}</p>}
      </section>
      </div>
    </main>
  );
}
