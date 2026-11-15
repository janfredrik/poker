import { useEffect, useState } from 'react';
import { formatChips } from '../../shared/presets';
import { seasonStandings, type SeasonNight } from '../../shared/results';

function Net({ amount }: { amount: number | null }) {
  if (amount == null) return <td>—</td>;
  return <td className={amount > 0 ? 'is-up' : amount < 0 ? 'is-down' : ''}>{amount > 0 ? '+' : ''}{formatChips(amount)}</td>;
}

function rebuyText(rebuys: number, addOns: number) {
  return addOns ? `${rebuys} + ${addOns === 1 ? 'add-on' : `${addOns} add-ons`}` : String(rebuys);
}

function Night({ night }: { night: SeasonNight }) {
  const date = new Date(night.finishedAt);
  const recorded = night.players.some((p) => p.rebuys != null);
  const showRebuys = night.players.some((p) => p.rebuys || p.addOn);
  return <details className="season__night">
    <summary>
      <strong>{night.name}</strong>
      <time dateTime={date.toISOString()}>{date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}</time>
    </summary>
    <table className="ledger">
      <caption className="sr-only">Sluttresultater for {night.name}</caption>
      <thead><tr><th>Plass / spiller</th>{showRebuys && <th>Rebuys</th>}{night.currency != null && <><th>Innbetalt</th><th>Premie</th><th>Netto ({night.currency})</th></>}</tr></thead>
      <tbody>{night.players.map((p) => <tr key={p.id}>
        <th scope="row">{p.place}. {p.name}</th>
        {showRebuys && <td>{recorded ? rebuyText(p.rebuys ?? 0, p.addOn ? 1 : 0) : '—'}</td>}
        {night.currency != null && <><td>{p.paid == null ? '—' : formatChips(p.paid)}</td><td>{formatChips(p.prize)}</td><Net amount={p.net} /></>}
      </tr>)}</tbody>
    </table>
  </details>;
}

function Standings({ nights }: { nights: SeasonNight[] }) {
  const currencies = [...new Set(nights.map((n) => n.currency))];
  return <>{currencies.map((currency) => {
    const rows = seasonStandings(nights.filter((n) => n.currency === currency));
    const showRebuys = rows.some((p) => p.rebuys || p.addOns);
    return <table className="ledger" key={JSON.stringify(currency)}>
      <caption className={currencies.length === 1 ? 'sr-only' : 'season__caption'}>{currency == null ? 'Spill uten premier' : `Sammenlagt i ${currency}`}</caption>
      <thead><tr><th>Spiller</th><th>Spill</th><th>Seire</th>{showRebuys && <th>Rebuys</th>}{currency != null && <th>Netto ({currency})</th>}</tr></thead>
      <tbody>{rows.map((p) => <tr key={p.key}>
        <th scope="row">{p.name}</th><td>{p.games}</td><td>{p.wins}</td>{showRebuys && <td>{rebuyText(p.rebuys, p.addOns)}</td>}{currency != null && <Net amount={p.net} />}
      </tr>)}</tbody>
    </table>;
  })}</>;
}

function PlayerStatsTable({ nights }: { nights: SeasonNight[] }) {
  const rows = seasonStandings(nights).sort((a, b) => b.stats.hands - a.stats.hands || a.name.localeCompare(b.name, 'nb'));
  return <>
    <div className="season__scroll" tabIndex={0} role="region" aria-label="Spillerstatistikk">
      <table className="ledger">
        <thead><tr><th>Spiller</th><th>Hender</th><th>VPIP</th><th>PFR</th><th>Vunne showdowns</th><th>Største pott (chips)</th></tr></thead>
        <tbody>{rows.map(({ key, name, stats: s }) => <tr key={key}>
          <th scope="row">{name}</th><td>{formatChips(s.hands)}</td>
          <td>{s.hands ? `${Math.round(100 * s.vpipHands / s.hands)}%` : '—'}</td>
          <td>{s.hands ? `${Math.round(100 * s.pfrHands / s.hands)}%` : '—'}</td>
          <td>{s.hands ? formatChips(s.showdownsWon) : '—'}</td><td>{s.hands ? formatChips(s.biggestPot) : '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="drawer__note">VPIP viser hvor ofte en spiller frivillig la chips i potten før flop. PFR viser hvor ofte spilleren raiset før flop. Begge andelene beregnes ut fra registrerte hender. Ved delt showdown får hver vinner én seier. Største pott er det høyeste antallet chips en spiller vant i én hånd, uten den delen av en bet som ingen callet.</p>
  </>;
}

export function Season() {
  const [nights, setNights] = useState<SeasonNight[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [year, setYear] = useState<number>();
  const [stats, setStats] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/season-results', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: SeasonNight[] = await response.json();
        if (!controller.signal.aborted) setNights(data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  const years = [...new Set(nights?.map((n) => n.year))].sort((a, b) => b - a);
  const selected = year ?? years[0];
  const games = nights?.filter((n) => n.year === selected) ?? [];
  return <main className="lobby">
    <a className="wordmark lobby__mast" href="/">Poker</a>
    <a className="season__nav" href="/">Tilbake til lobbyen</a>
    <div className="lobby__stage season">
      <header className="season__head">
        <h1>Sesongoversikt</h1>
        {selected && <label className="field"><span className="sr-only">Sesong</span>
          <select aria-label="Sesong" value={selected} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </label>}
      </header>
      {error ? <div role="alert"><p>Kunne ikke hente sesongresultatene.</p><button className="btn btn--quiet" onClick={() => { setError(false); setAttempt(attempt + 1); }}>Prøv igjen</button></div>
        : !nights ? <p role="status">Henter sesongresultater …</p>
        : !games.length ? <p>Den første turneringen vises her når den er ferdigspilt.</p>
        : <>
          <section className="season__section" aria-label="Sammenlagt for sesongen">
            <div className="seg" role="group" aria-label="Sesongvisning">
              <button aria-pressed={!stats} onClick={() => setStats(false)}>Sammenlagt</button>
              <button aria-pressed={stats} onClick={() => setStats(true)}>Spillerstatistikk</button>
            </div>
            {stats ? <PlayerStatsTable nights={games} /> : <Standings nights={games} />}
          </section>
          <section className="season__section">
            <h2>Spillekvelder</h2>
            {games.map((night) => <Night key={night.id} night={night} />)}
          </section>
        </>}
    </div>
  </main>;
}
