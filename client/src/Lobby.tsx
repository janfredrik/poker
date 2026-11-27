import { useEffect, useState } from 'react';
import type { RuleSet } from '../../shared/types';
import { BUILT_IN_RULESETS } from '../../shared/presets';
import { call, prefs, socket, tokens } from './lib/socket';
import { RulesPicker } from './ui/RulesPicker';
import { PlayingCard } from './table/Card';
import { ThemePicker } from './ui/ThemePicker';

export function Lobby({ navigate }: { navigate: (path: string) => void }) {
  const [name, setName] = useState(prefs.get('name'));
  const [tableName, setTableName] = useState(prefs.get('tableName', 'Fredagspoker'));
  const [rules, setRules] = useState<RuleSet>(structuredClone(BUILT_IN_RULESETS.find((r) => r.id === 'friday-300') ?? BUILT_IN_RULESETS[0]));
  const [approval, setApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState(prefs.get('createCode'));

  useEffect(() => {
    socket.connect();
    fetch('/api/config').then((r) => r.json()).then((c: { needsCode?: boolean }) => setNeedsCode(Boolean(c.needsCode))).catch(() => {});
  }, []);

  const [bots, setBots] = useState(3);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const demo = async () => {
    setDemoError(null);
    setDemoBusy(true);
    try {
      const res = await call<{ tableId: string; token: string }>('demo:create', { name: name.trim() || 'Du', bots });
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
    if (!name.trim()) { setError('Skriv inn navnet ditt så vennene dine ser hvem som er vert.'); return; }
    if (needsCode && !code.trim()) { setError('Skriv inn koden for å åpne bord.'); return; }
    setBusy(true);
    try {
      const res = await call<{ tableId: string; token: string }>('table:create', {
        hostName: name, code: code.trim(), settings: { name: tableName, requireApproval: approval, rules },
      });
      if (needsCode) prefs.set('createCode', code.trim());
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
      <div className="lobby__tools">
        <a className="season__nav" href="/season">Sesongoversikt</a>
        <ThemePicker />
      </div>
      <div className="lobby__stage">
        <div className="lobby__lamp" aria-hidden="true" />
        <header className="lobby__head">
          <h1 className="lobby__title">Inviter til <span>poker i kveld</span></h1>
        </header>

      <form className="lobby__card" onSubmit={create}>
        <div className="spread" aria-hidden="true">
          <span className="spread__card spread__card--a"><PlayingCard card="As" size="lg" /></span>
          <span className="spread__card spread__card--b"><PlayingCard card="Ah" size="lg" /></span>
          <span className="marker marker--dealer spread__button">D</span>
        </div>
        <div className="lobby__row">
          <label className="field">
            <span className="field__label">Ditt navn</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18} autoComplete="nickname" autoFocus={!name} placeholder="Jani" />
          </label>
          <label className="field">
            <span className="field__label">Bordnavn</span>
            <input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={40} />
          </label>
        </div>

        <RulesPicker value={rules} onChange={setRules} />

        <label className="toggle">
          <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          <span className="toggle__track" aria-hidden="true" />
          Jeg vil godkjenne spillere før de får et sete
        </label>

        {needsCode && (
          <label className="field field--wide">
            <span className="field__label">Kode for å åpne bord</span>
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} maxLength={100} autoComplete="off" />
          </label>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="lobby__submit">
          <button className="btn btn--act btn--lg" disabled={busy}>{busy ? 'Åpner bordet …' : 'Åpne bordet'}</button>
        </div>
      </form>

      <section className="demo" aria-labelledby="demo-title">
        <div className="demo__text">
          <h2 className="demo__title" id="demo-title">Vil du prøve først?</h2>
          <p className="demo__lede">Spill noen hender mot bots.</p>
        </div>
        <div className="demo__controls">
          <div className="demo__count" role="radiogroup" aria-label="Antall datamotstandere">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={bots === n} className={`demo__n ${bots === n ? 'is-on' : ''}`} onClick={() => setBots(n)}>{n}</button>
            ))}
          </div>
          <button type="button" className="btn btn--lg demo__go" disabled={demoBusy} onClick={() => void demo()}>
            {demoBusy ? 'Deler ut kort …' : `Spill mot ${bots} ${bots === 1 ? 'bot' : 'bots'}`}
          </button>
        </div>
        {demoError && <p className="form-error" role="alert">{demoError}</p>}
      </section>
      </div>
    </main>
  );
}
