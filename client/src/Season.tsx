import { useEffect, useState } from 'react';
import { formatChips } from '../../shared/presets';
import { seasonStandings, type SeasonNight } from '../../shared/results';

function Net({ amount }: { amount: number | null }) {
  if (amount == null) return <td>—</td>;
  return <td className={amount > 0 ? 'is-up' : amount < 0 ? 'is-down' : ''}>{amount > 0 ? '+' : ''}{formatChips(amount)}</td>;
}

function Night({ night }: { night: SeasonNight }) {
  const date = new Date(night.finishedAt);
  return <details className="season__night">
    <summary>
      <strong>{night.name}</strong>
      <time dateTime={date.toISOString()}>{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time>
    </summary>
    <table className="ledger">
      <caption className="sr-only">{night.name} final standings</caption>
      <thead><tr><th>Place / Player</th>{night.currency != null && <><th>Paid</th><th>Prize</th><th>Net ({night.currency})</th></>}</tr></thead>
      <tbody>{night.players.map((p) => <tr key={p.id}>
        <th scope="row">{p.place}. {p.name}</th>
        {night.currency != null && <><td>{p.paid == null ? '—' : formatChips(p.paid)}</td><td>{formatChips(p.prize)}</td><Net amount={p.net} /></>}
      </tr>)}</tbody>
    </table>
  </details>;
}

function Standings({ nights }: { nights: SeasonNight[] }) {
  const currencies = [...new Set(nights.map((n) => n.currency))];
  return <>{currencies.map((currency) => {
    const rows = seasonStandings(nights.filter((n) => n.currency === currency));
    return <table className="ledger" key={JSON.stringify(currency)}>
      <caption className={currencies.length === 1 ? 'sr-only' : 'season__caption'}>{currency == null ? 'Games without payouts' : `Standings in ${currency}`}</caption>
      <thead><tr><th>Player</th><th>Games</th><th>Wins</th>{currency != null && <th>Net ({currency})</th>}</tr></thead>
      <tbody>{rows.map((p) => <tr key={p.key}>
        <th scope="row">{p.name}</th><td>{p.games}</td><td>{p.wins}</td>{currency != null && <Net amount={p.net} />}
      </tr>)}</tbody>
    </table>;
  })}</>;
}

function PlayerStatsTable({ nights }: { nights: SeasonNight[] }) {
  const rows = seasonStandings(nights).sort((a, b) => b.stats.hands - a.stats.hands || a.name.localeCompare(b.name));
  return <>
    <div className="season__scroll" tabIndex={0} role="region" aria-label="Player statistics">
      <table className="ledger">
        <thead><tr><th>Player</th><th>Hands</th><th>VPIP</th><th>PFR</th><th>Showdowns won</th><th>Biggest pot (chips)</th></tr></thead>
        <tbody>{rows.map(({ key, name, stats: s }) => <tr key={key}>
          <th scope="row">{name}</th><td>{formatChips(s.hands)}</td>
          <td>{s.hands ? `${Math.round(100 * s.vpipHands / s.hands)}%` : '—'}</td>
          <td>{s.hands ? `${Math.round(100 * s.pfrHands / s.hands)}%` : '—'}</td>
          <td>{s.hands ? formatChips(s.showdownsWon) : '—'}</td><td>{s.hands ? formatChips(s.biggestPot) : '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="drawer__note">VPIP is the share of tracked hands where a player put chips in voluntarily before the flop. PFR is the share where they raised before the flop. A split showdown counts once for each winner. Biggest pot is the most chips a player collected in one hand, excluding uncalled bets.</p>
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
    <a className="season__nav" href="/">Back to lobby</a>
    <div className="lobby__stage season">
      <header className="season__head">
        <h1>Season standings</h1>
        {selected && <label className="field"><span className="sr-only">Season</span>
          <select aria-label="Season" value={selected} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </label>}
      </header>
      {error ? <div role="alert"><p>Couldn’t load the season results.</p><button className="btn btn--quiet" onClick={() => { setError(false); setAttempt(attempt + 1); }}>Try again</button></div>
        : !nights ? <p role="status">Loading season results…</p>
        : !games.length ? <p>The first finished tournament will appear here.</p>
        : <>
          <section className="season__section" aria-label="Season totals">
            <div className="seg" role="group" aria-label="Season view">
              <button aria-pressed={!stats} onClick={() => setStats(false)}>Standings</button>
              <button aria-pressed={stats} onClick={() => setStats(true)}>Player stats</button>
            </div>
            {stats ? <PlayerStatsTable nights={games} /> : <Standings nights={games} />}
          </section>
          <section className="season__section">
            <h2>Game nights</h2>
            {games.map((night) => <Night key={night.id} night={night} />)}
          </section>
        </>}
    </div>
  </main>;
}
