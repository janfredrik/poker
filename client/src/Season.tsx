import { useEffect, useId, useState } from 'react';
import { formatChips } from '../../shared/presets';
import { playStyle, seasonStandings, statRates, type SeasonNight } from '../../shared/results';
import { PlayingCard } from './table/Card';

type Standing = ReturnType<typeof seasonStandings>[number];

const list = new Intl.ListFormat('nb', { type: 'conjunction' });

function Net({ amount }: { amount: number | null }) {
  if (amount == null) return <td>—</td>;
  return <td className={amount > 0 ? 'is-up' : amount < 0 ? 'is-down' : ''}>{amount > 0 ? '+' : ''}{formatChips(amount)}</td>;
}

function rebuyText(rebuys: number, addOns: number) {
  return addOns ? `${rebuys} + ${addOns === 1 ? 'add-on' : `${addOns} add-ons`}` : String(rebuys);
}

function pct(rate: number | null) {
  return rate == null ? '—' : `${Math.round(100 * rate)} %`;
}

function duration(ms: number) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  return h ? `${h} t ${minutes % 60} min` : `${minutes} min`;
}

function shortDate(at: number) {
  return new Date(at).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

/** Everyone sharing the top value, or null when nobody scored. */
function leaders<T>(items: T[], value: (item: T) => number) {
  const best = Math.max(0, ...items.map(value));
  return best > 0 ? { value: best, items: items.filter((item) => value(item) === best) } : null;
}

function InfoIcon() {
  return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 8.6v5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="10" cy="6.1" r="1.05" fill="currentColor" />
  </svg>;
}

const TERMS: { term: string; full?: string; text: string }[] = [
  { term: 'VPIP', full: 'Voluntarily put money in pot', text: 'Andelen hender der spilleren frivillig la chips i potten før flop, med call eller raise. Blinds teller ikke. Rundt 20–25 % er tight, over 35 % er løst.' },
  { term: 'PFR', full: 'Pre-flop raise', text: 'Andelen hender der spilleren raiset før flop. Jo nærmere PFR ligger VPIP, jo oftere går spilleren inn med en raise i stedet for en call.' },
  { term: 'AF', full: 'Aggression factor', text: 'Bets og raises delt på calls etter flop. Over 2 er aggressivt, under 1 er passivt. ∞ betyr at spilleren aldri callet etter flop.' },
  { term: 'WTSD', full: 'Went to showdown', text: 'Av hendene der spilleren så flop: andelen som endte med at kortene ble vist mot minst én motstander.' },
  { term: 'W$SD', full: 'Won money at showdown', text: 'Andelen av spillerens showdowns som ga chips tilbake. En delt pott teller som vunnet.' },
  { term: 'Vunne hender', text: 'Andelen hender spilleren vant chips i, med eller uten showdown.' },
  { term: 'Største pott', text: 'Flest chips spilleren vant i én hånd, uten den delen av en bet som ingen callet.' },
  { term: 'Spillestil', text: 'Tight eller løs ut fra VPIP (grense 25 %), aggressiv eller passiv ut fra om minst halvparten av VPIP-hendene var raise. Vises fra 40 hender.' },
];

function Explainer({ id }: { id: string }) {
  return <div className="season__explainer" id={id}>
    <dl>{TERMS.map(({ term, full, text }) => <div key={term}>
      <dt>{term}{full && <span lang="en"> · {full}</span>}</dt>
      <dd>{text}</dd>
    </div>)}</dl>
    <p>Alle andeler regnes av ferdigspilte hender. AF, WTSD og W$SD registreres bare på kvelder spilt etter at de ble lagt til, så eldre kvelder vises som —.</p>
  </div>;
}

function Standings({ nights }: { nights: SeasonNight[] }) {
  // Money tables first; nights without prizes last.
  const currencies = [...new Set(nights.map((n) => n.currency))].sort((a, b) => (a == null ? 1 : 0) - (b == null ? 1 : 0));
  return <>{currencies.map((currency) => {
    const rows = seasonStandings(nights.filter((n) => n.currency === currency));
    const showRebuys = rows.some((p) => p.rebuys || p.addOns);
    const showKo = rows.some((p) => p.knockouts);
    return <div className="season__scroll" key={JSON.stringify(currency)} tabIndex={0} role="region" aria-label={currency == null ? 'Spill uten premier' : `Sammenlagt i ${currency}`}>
      <table className="ledger season__table">
        <caption className={currencies.length === 1 ? 'sr-only' : 'season__caption'}>{currency == null ? 'Spill uten premier' : `Sammenlagt i ${currency}`}</caption>
        <thead><tr><th>Spiller</th><th>Spill</th><th>Seire</th>{currency != null && <th>I premie</th>}{showKo && <th>Knockouts</th>}{showRebuys && <th>Rebuys</th>}{currency != null && <th>Netto ({currency})</th>}</tr></thead>
        <tbody>{rows.map((p, i) => <tr key={p.key} className={i === 0 && currency != null && p.net > 0 ? 'is-leader' : ''}>
          <th scope="row"><span className="season__place">{i + 1}</span>{p.name}</th>
          <td>{p.games}</td><td>{p.wins}</td>{currency != null && <td>{p.cashes}</td>}{showKo && <td>{p.knockouts}</td>}
          {showRebuys && <td>{rebuyText(p.rebuys, p.addOns)}</td>}{currency != null && <Net amount={p.net} />}
        </tr>)}</tbody>
      </table>
    </div>;
  })}</>;
}

function PlayerStatsTable({ rows }: { rows: Standing[] }) {
  const sorted = [...rows].sort((a, b) => b.stats.hands - a.stats.hands || a.name.localeCompare(b.name, 'nb'));
  const af = (v: number | null) => (v == null ? '—' : v === Infinity ? '∞' : v.toLocaleString('nb-NO', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
  return <div className="season__scroll" tabIndex={0} role="region" aria-label="Spillerstatistikk">
    <table className="ledger season__table">
      <thead><tr>
        <th>Spiller</th><th>Hender</th>
        <th><abbr title="Voluntarily put money in pot">VPIP</abbr></th><th><abbr title="Pre-flop raise">PFR</abbr></th>
        <th><abbr title="Aggression factor">AF</abbr></th><th><abbr title="Went to showdown">WTSD</abbr></th><th><abbr title="Won money at showdown">W$SD</abbr></th>
        <th>Vunne hender</th><th>Største pott</th>
      </tr></thead>
      <tbody>{sorted.map(({ key, name, stats: s }) => {
        const r = statRates(s);
        const style = playStyle(s);
        return <tr key={key}>
          <th scope="row">{name}{style && <span className="season__style">{style}</span>}</th>
          <td>{formatChips(s.hands)}</td><td>{pct(r.vpip)}</td><td>{pct(r.pfr)}</td><td>{af(r.af)}</td>
          <td>{pct(r.wtsd)}</td><td>{pct(r.wsd)}</td><td>{pct(r.won)}</td><td>{s.hands ? formatChips(s.biggestPot) : '—'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function Records({ nights, rows }: { nights: SeasonNight[]; rows: Standing[] }) {
  const best = leaders(rows.filter((p) => p.bestHand), (p) => p.bestHand!.score + 1);
  const hand = best?.items[0].bestHand;
  const names = (items: Standing[]) => list.format(items.map((p) => p.name));
  const records = [
    { label: 'Største pott', top: leaders(rows, (p) => p.stats.biggestPot), show: (v: number) => `${formatChips(v)} chips` },
    { label: 'Flest knockouts', top: leaders(rows, (p) => p.knockouts), show: (v: number) => String(v) },
    { label: 'Flest vunne hender', top: leaders(rows, (p) => p.stats.handsWon ?? 0), show: (v: number) => formatChips(v) },
  ].flatMap(({ label, top, show }) => top ? [{ label, who: names(top.items), value: show(top.value) }] : []);
  const longest = leaders(nights, (n) => n.playedMs ?? 0);
  if (longest) records.push({ label: 'Lengste kveld', who: list.format(longest.items.map((n) => n.name)), value: duration(longest.value) });
  if (!hand && !records.length) return null;
  return <section className="season__section" aria-labelledby="season-records">
    <h2 id="season-records">Sesongens rekorder</h2>
    <div className="season__records">
      {hand && <figure className="season__hand">
        <div className="season__board">{hand.cards.map((c) => <PlayingCard key={c} card={c} />)}</div>
        <figcaption><strong>{hand.name}</strong><span>{names(best!.items)}{best!.items.length === 1 && ` · ${hand.night}`}</span></figcaption>
      </figure>}
      {records.length > 0 && <dl className="season__facts">{records.map((r) => <div key={r.label}>
        <dt>{r.label}</dt><dd><span>{r.who}</span><strong>{r.value}</strong></dd>
      </div>)}</dl>}
    </div>
  </section>;
}

function Night({ night }: { night: SeasonNight }) {
  const date = new Date(night.finishedAt);
  const recorded = night.players.some((p) => p.rebuys != null);
  const showRebuys = night.players.some((p) => p.rebuys || p.addOn);
  const showKo = night.players.some((p) => p.knockouts?.length);
  const showHands = night.players.some((p) => p.bestHand);
  const winner = night.players.find((p) => p.place === 1);
  return <details className="season__night">
    <summary>
      <span className="season__night-name"><strong>{night.name}</strong>{winner && <span>Vinner: {winner.name}</span>}</span>
      <span className="season__night-meta">
        {night.playedMs ? <span>{duration(night.playedMs)}</span> : null}
        <time dateTime={date.toISOString()}>{shortDate(night.finishedAt)}</time>
      </span>
    </summary>
    <div className="season__scroll" tabIndex={0} role="region" aria-label={`Sluttresultater for ${night.name}`}>
      <table className="ledger season__table">
        <thead><tr><th>Plass / spiller</th>{showKo && <th>Knockouts</th>}{showRebuys && <th>Rebuys</th>}{showHands && <th>Beste hånd</th>}{night.currency != null && <><th>Innbetalt</th><th>Premie</th><th>Netto ({night.currency})</th></>}</tr></thead>
        <tbody>{night.players.map((p) => <tr key={p.id}>
          <th scope="row"><span className="season__place">{p.place}</span>{p.name}</th>
          {showKo && <td>{p.knockouts?.length ?? '—'}</td>}
          {showRebuys && <td>{recorded ? rebuyText(p.rebuys ?? 0, p.addOn ? 1 : 0) : '—'}</td>}
          {showHands && <td className="season__handname">{p.bestHand?.name ?? '—'}</td>}
          {night.currency != null && <><td>{p.paid == null ? '—' : formatChips(p.paid)}</td><td>{formatChips(p.prize)}</td><Net amount={p.net} /></>}
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function Season() {
  const [nights, setNights] = useState<SeasonNight[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [year, setYear] = useState<number>();
  const [stats, setStats] = useState(false);
  const [explain, setExplain] = useState(false);
  const explainerId = useId();
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
  const everyone = seasonStandings(games);
  const played = games.reduce((sum, n) => sum + (n.playedMs ?? 0), 0);
  return <main className="lobby">
    <a className="wordmark lobby__mast" href="/">Poker</a>
    <a className="season__nav" href="/">Tilbake til lobbyen</a>
    <div className="lobby__stage season">
      <header className="season__head">
        <div className="season__title">
          <h1>Sesongoversikt</h1>
          {games.length > 0 && <p className="season__summary">
            {games.length === 1 ? '1 spillekveld' : `${games.length} spillekvelder`}
            {played > 0 && <> · {duration(played)} ved bordet</>}
            {' · '}{everyone.length} spillere
          </p>}
        </div>
        {selected && <label className="field season__year"><span className="sr-only">Sesong</span>
          <select value={selected} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </label>}
      </header>
      {error ? <div role="alert" className="season__section"><p>Kunne ikke hente sesongresultatene.</p><button className="btn btn--quiet" onClick={() => { setError(false); setAttempt(attempt + 1); }}>Prøv igjen</button></div>
        : !nights ? <p role="status">Henter sesongresultater …</p>
        : !games.length ? <p>Den første turneringen vises her når den er ferdigspilt.</p>
        : <>
          <section className="season__section" aria-labelledby="season-standings">
            <h2 id="season-standings" className="sr-only">Stillingen</h2>
            <div className="season__bar">
              <div className="seg" role="group" aria-label="Sesongvisning">
                <button aria-pressed={!stats} onClick={() => setStats(false)}>Sammenlagt</button>
                <button aria-pressed={stats} onClick={() => setStats(true)}>Spillerstatistikk</button>
              </div>
              {stats && <button className="season__info" aria-expanded={explain} aria-controls={explainerId} onClick={() => setExplain(!explain)}>
                <InfoIcon />{explain ? 'Skjul forklaringen' : 'Hva betyr tallene?'}
              </button>}
            </div>
            {stats && explain && <Explainer id={explainerId} />}
            {stats ? <PlayerStatsTable rows={everyone} /> : <Standings nights={games} />}
          </section>
          <Records nights={games} rows={everyone} />
          <section className="season__section" aria-labelledby="season-nights">
            <h2 id="season-nights">Spillekvelder</h2>
            <div>{games.map((night) => <Night key={night.id} night={night} />)}</div>
          </section>
        </>}
    </div>
  </main>;
}
