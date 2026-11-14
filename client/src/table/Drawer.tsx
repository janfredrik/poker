import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { LogEntry, RuleSet, TableView } from '../../../shared/types';
import { formatChips } from '../../../shared/presets';
import { RulesPicker, summarize } from '../ui/RulesPicker';

export type DrawerTab = 'log' | 'ledger' | 'players' | 'rules';

interface Props {
  view: TableView;
  tab: DrawerTab;
  setTab: (t: DrawerTab) => void;
  run: (event: string, payload?: unknown) => Promise<unknown>;
  onClose: () => void;
}

const time = (t: number) => new Date(t).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

function LogLine({ e }: { e: LogEntry }) {
  if (e.kind === 'chat') {
    return (
      <li className="log__chat">
        <span className="log__who">{e.by}</span> {e.text}
      </li>
    );
  }
  return <li className={`log__${e.kind}`}><time>{time(e.t)}</time>{e.text}</li>;
}

export function Drawer({ view, tab, setTab, run, onClose }: Props) {
  const isHost = view.you.isHost;
  const me = view.players.find((p) => p.id === view.you.playerId);
  const pending = view.players.filter((p) => p.status === 'pending');
  const listRef = useRef<HTMLOListElement>(null);
  const [chat, setChat] = useState('');
  const [filter, setFilter] = useState<'all' | 'chat'>('all');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.log.length, tab, filter]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chat.trim();
    if (!text) return;
    setChat('');
    await run('chat', text);
  };

  return (
    <aside className="drawer" aria-label="Borddetaljer">
      <div className="drawer__tabs" role="tablist">
        {([['log', 'Logg og chat'], ['ledger', 'Regnskap'], ['players', isHost && pending.length ? `Spillere · ${pending.length}` : 'Spillere'], ['rules', 'Regler']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="drawer__tab" onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="iconbtn iconbtn--sm drawer__close" onClick={onClose} aria-label="Lukk panelet"><X size={16} /></button>
      </div>

      {tab === 'log' && (
        <div className="drawer__body drawer__body--log">
          <div className="seg" role="group" aria-label="Vis meldinger">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Alt</button>
            <button aria-pressed={filter === 'chat'} onClick={() => setFilter('chat')}>Bare chat</button>
          </div>
          <ol className="log" ref={listRef}>
            {view.log.filter((e) => filter === 'all' || e.kind === 'chat').map((e, i) => <LogLine key={i} e={e} />)}
          </ol>
          {me ? (
            <form className="chatbox" onSubmit={send}>
              <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Skriv en melding til bordet" maxLength={300} aria-label="Chatmelding" />
              <button className="btn btn--quiet btn--sm" disabled={!chat.trim()}>Send</button>
            </form>
          ) : <p className="drawer__note">Velg et sete ved bordet for å chatte.</p>}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="drawer__body">
          {view.status === 'finished' && <a href="/season">Sesongoversikt</a>}
          {view.results && <Settlement view={view} />}
          {view.ledger.length === 0 ? (
            <p className="drawer__note">Her ser du buy-ins, rebuys og resultater når spillerne har valgt sete.</p>
          ) : (
            <table className="ledger">
              <thead>
                <tr><th scope="col">Spiller</th><th scope="col">Inn</th><th scope="col">Nå</th><th scope="col">Netto</th></tr>
              </thead>
              <tbody>
                {view.ledger.map((r) => (
                  <tr key={r.playerId}>
                    <th scope="row">{r.name}{r.rebuys > 0 && <span className="ledger__rb"> · {r.rebuys} rebuy{r.rebuys > 1 ? 's' : ''}</span>}</th>
                    <td>{formatChips(r.buyIn)}</td>
                    <td>{formatChips(r.stack + r.cashOut)}</td>
                    <td className={r.net > 0 ? 'is-up' : r.net < 0 ? 'is-down' : ''}>{r.net > 0 ? '+' : ''}{formatChips(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Totalt</th>
                  <td>{formatChips(view.ledger.reduce((s, r) => s + r.buyIn, 0))}</td>
                  <td>{formatChips(view.ledger.reduce((s, r) => s + r.stack + r.cashOut, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <p className="drawer__note">
            {view.settings.rules.cashOut
              ? '«Nå» viser spillerens chips ved bordet pluss tidligere cash-outs. Chips i potten telles med når hånden er ferdig.'
              : 'Dette spillet har ingen cash-outs. Spillere som forlater bordet etter start, mister chipsene sine. Chips i potten telles med når hånden er ferdig.'}
          </p>
        </div>
      )}

      {tab === 'players' && <PlayersTab view={view} run={run} />}
      {tab === 'rules' && <RulesTab view={view} run={run} />}
    </aside>
  );
}

function Settlement({ view }: { view: TableView }) {
  const r = view.results!;
  const cur = r.currency;
  const done = view.status === 'finished';
  const won = (id: string) => r.places.find((pl) => pl.playerId === id)?.prize ?? 0;
  const rows = view.players
    .filter((p) => r.paid[p.id] != null)
    .map((p) => ({ id: p.id, name: p.name, paid: r.paid[p.id], won: won(p.id), place: p.place }))
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.won - a.won);
  return (
    <section className="settle">
      <h3 className="drawer__h">Oppgjør</h3>
      <p className="drawer__note">
        {r.entries} buy-ins{r.rebuys ? ` + ${r.rebuys} rebuy${r.rebuys > 1 ? 's' : ''}` : ''}{r.addOns ? ` + ${r.addOns} add-on${r.addOns > 1 ? 's' : ''}` : ''} = <b>{formatChips(r.pool)} {cur}</b>.
        Alle buy-ins går til vinneren. Rebuys fordeles i tur og orden fra førsteplass til {r.places.length}. plass, før fordelingen starter på nytt.
      </p>
      <ol className="settle__places">
        {r.places.map((pl) => (
          <li key={pl.place}>
            <span className="settle__place">{pl.place}</span>
            <span className="settle__who">{pl.name ?? (done ? '—' : 'Spiller fortsatt')}</span>
            <span className="settle__prize">{formatChips(pl.prize)} {cur}</span>
          </li>
        ))}
      </ol>
      {done && (
        <table className="ledger">
          <thead><tr><th scope="col">Spiller</th><th scope="col">Innbetalt</th><th scope="col">Gevinst</th><th scope="col">Netto</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const net = x.won - x.paid;
              return (
                <tr key={x.id}>
                  <th scope="row">{x.place ? `${x.place}. ` : ''}{x.name}</th>
                  <td>{formatChips(x.paid)}</td>
                  <td>{formatChips(x.won)}</td>
                  <td className={net > 0 ? 'is-up' : net < 0 ? 'is-down' : ''}>{net > 0 ? '+' : ''}{formatChips(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="drawer__note">Appen regner ut hvem som skylder hva. Dere gjør opp dere imellom.</p>
    </section>
  );
}

function PlayersTab({ view, run }: { view: TableView; run: Props['run'] }) {
  const isHost = view.you.isHost;
  const me = view.players.find((p) => p.id === view.you.playerId);
  const [editing, setEditing] = useState<string | null>(null);
  const [stack, setStack] = useState('');
  const [rename, setRename] = useState(me?.name ?? '');
  const pending = view.players.filter((p) => p.status === 'pending');
  const cashOut = view.settings.rules.cashOut || view.status === 'waiting';
  const seated = view.players.filter((p) => p.status === 'seated').sort((a, b) => a.seat! - b.seat!);

  return (
    <div className="drawer__body">
      {isHost && pending.length > 0 && (
        <section className="plist">
          <h3 className="drawer__h">Venter på sete</h3>
          {pending.map((p) => (
            <div className="plist__row" key={p.id}>
              <span className="plist__name">{p.name}<span className="plist__sub">Sete {p.requestedSeat} · {formatChips(p.requestedBuyIn)}</span></span>
              <button className="btn btn--act btn--sm" onClick={() => run('host:approve', p.id)}><Check size={14} /> Godkjenn</button>
              <button className="btn btn--quiet btn--sm" onClick={() => run('host:reject', p.id)}>Avslå</button>
            </div>
          ))}
        </section>
      )}

      <section className="plist">
        <h3 className="drawer__h">Ved bordet</h3>
        {seated.length === 0 && <p className="drawer__note">Ingen har valgt sete ennå.</p>}
        {seated.map((p) => (
          <div className="plist__item" key={p.id}>
            <div className="plist__row">
              <span className="plist__name">
                {p.name}
                <span className="plist__sub">Sete {p.seat} · {formatChips(p.stack)}{p.isHost ? ' · vert' : ''}{!p.connected ? ' · frakoblet' : ''}</span>
              </span>
              {isHost && (
                <button className="btn btn--quiet btn--sm" aria-expanded={editing === p.id} onClick={() => { setEditing(editing === p.id ? null : p.id); setStack(String(p.stack)); }}>
                  Administrer
                </button>
              )}
            </div>
            {isHost && editing === p.id && (
              <div className="plist__manage">
                <form className="inline" onSubmit={async (e) => { e.preventDefault(); await run('host:stack', { playerId: p.id, stack: Number(stack) }); setEditing(null); }}>
                  <label className="field field--inline">
                    <span className="field__label">Stack</span>
                    <input inputMode="numeric" value={stack} onChange={(e) => setStack(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <button className="btn btn--quiet btn--sm">Endre stack</button>
                </form>
                <p className="field__hint">Endringen føres som en justering av buy-in i regnskapet.</p>
                {!p.isHost && (
                  <div className="plist__actions">
                    <button className="btn btn--quiet btn--sm" onClick={() => run('host:transfer', p.id)}>Gjør til vert</button>
                    <button className="btn btn--danger btn--sm" onClick={() => run('host:kick', p.id)}>{cashOut ? 'Fjern og registrer cash-out' : 'Fjern (chips tas ut av spill)'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      {me && (
        <section className="plist">
          <h3 className="drawer__h">Du</h3>
          <form className="inline" onSubmit={(e) => { e.preventDefault(); void run('player:rename', rename); }}>
            <label className="field field--inline">
              <span className="field__label">Navn</span>
              <input value={rename} onChange={(e) => setRename(e.target.value)} maxLength={18} />
            </label>
            <button className="btn btn--quiet btn--sm" disabled={rename.trim() === me.name}>Endre navn</button>
          </form>
          {me.status !== 'watching' && (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => {
                if (me.status === 'seated' && !cashOut && !window.confirm(`Vil du forlate bordet? Dine ${formatChips(me.stack)} chips tas ut av spill. Du kan også stå over hender.`)) return;
                void run('seat:leave');
              }}
            >
              {me.status === 'pending' ? 'Trekk forespørselen' : cashOut ? `Forlat setet med cash-out på ${formatChips(me.stack)}` : 'Forlat bordet (chips tas ut av spill)'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function RulesTab({ view, run }: { view: TableView; run: Props['run'] }) {
  const isHost = view.you.isHost;
  const [draft, setDraft] = useState<RuleSet>(view.settings.rules);
  const [approval, setApproval] = useState(view.settings.requireApproval);
  const [name, setName] = useState(view.settings.name);
  const [saved, setSaved] = useState(false);
  const r = view.settings.rules;
  const timed = r.levelMinutes > 0;

  if (!isHost) {
    return (
      <div className="drawer__body">
        <h3 className="drawer__h">{r.name}</h3>
        <p className="drawer__note">{summarize(r)}</p>
        {timed && (
          <ol className="structure">
            {r.levels.map((l, i) => (
              <li key={i} className={i === view.clock.levelIndex ? 'is-current' : i < view.clock.levelIndex ? 'is-past' : ''}>
                <span>Nivå {i + 1}</span>
                <span>{formatChips(l.sb)} / {formatChips(l.bb)}{l.ante ? ` · ${formatChips(l.ante)}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
        {r.rebuy.enabled && (
          <p className="drawer__note">
            Rebuys{r.rebuy.amount ? ` på ${formatChips(r.rebuy.amount)} chips` : ''}
            {r.rebuy.maxStackToRebuy === 0 ? ' når du er tom for chips' : r.rebuy.maxStackToRebuy > 0 ? ` når du har ${formatChips(r.rebuy.maxStackToRebuy)} chips eller færre` : ' mellom hender'}
            {timed && r.rebuy.untilLevel ? `, til og med nivå ${r.rebuy.untilLevel}` : ''}
            {r.rebuy.maxPerPlayer ? `, maks ${r.rebuy.maxPerPlayer} per spiller` : ''}.
          </p>
        )}
        {timed && r.addOn.enabled && <p className="drawer__note">Add-on på {formatChips(r.addOn.amount)} chips på nivå {r.addOn.atLevel}–{r.addOn.atLevel + 1}.</p>}
      </div>
    );
  }

  return (
    <div className="drawer__body">
      <label className="field">
        <span className="field__label">Bordnavn</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <RulesPicker value={draft} onChange={(v) => { setDraft(v); setSaved(false); }} currentLevel={view.clock.levelIndex} />
      <label className="toggle">
        <input type="checkbox" checked={approval} onChange={(e) => { setApproval(e.target.checked); setSaved(false); }} />
        <span className="toggle__track" aria-hidden="true" />
        Godkjenn spillere før de får et sete
      </label>
      <div className="rules__row">
        <button className="btn btn--act btn--sm" onClick={async () => { await run('host:settings', { name, requireApproval: approval, rules: draft }); setSaved(true); }}>
          Bruk på dette bordet
        </button>
        {saved && <span className="picker__status" role="status">Reglene er oppdatert. Nye blinds gjelder fra neste hånd.</span>}
      </div>
      {timed && (
        <div className="rules__row">
          <span className="field__label">Blindklokke</span>
          <button className="btn btn--quiet btn--sm" disabled={view.clock.levelIndex === 0} onClick={() => run('host:level', view.clock.levelIndex - 1)}>Forrige nivå</button>
          <button className="btn btn--quiet btn--sm" onClick={() => run('host:level', view.clock.levelIndex + 1)}>Neste nivå</button>
        </div>
      )}
      <div className="rules__row rules__row--end">
        <button
          className="btn btn--danger btn--sm"
          onClick={() => { if (window.confirm('Vil du stenge bordet for alle? Regnskapet slettes også.')) void run('host:close'); }}
        >
          Steng bordet
        </button>
      </div>
    </div>
  );
}
