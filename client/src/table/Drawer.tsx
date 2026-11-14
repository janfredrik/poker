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

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
    <aside className="drawer" aria-label="Table details">
      <div className="drawer__tabs" role="tablist">
        {([['log', 'Log & chat'], ['ledger', 'Ledger'], ['players', isHost && pending.length ? `Players · ${pending.length}` : 'Players'], ['rules', 'Rules']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="drawer__tab" onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="iconbtn iconbtn--sm drawer__close" onClick={onClose} aria-label="Close panel"><X size={16} /></button>
      </div>

      {tab === 'log' && (
        <div className="drawer__body drawer__body--log">
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Everything</button>
            <button aria-pressed={filter === 'chat'} onClick={() => setFilter('chat')}>Chat only</button>
          </div>
          <ol className="log" ref={listRef}>
            {view.log.filter((e) => filter === 'all' || e.kind === 'chat').map((e, i) => <LogLine key={i} e={e} />)}
          </ol>
          {me ? (
            <form className="chatbox" onSubmit={send}>
              <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Say something to the table" maxLength={300} aria-label="Chat message" />
              <button className="btn btn--quiet btn--sm" disabled={!chat.trim()}>Send</button>
            </form>
          ) : <p className="drawer__note">Take a seat to chat.</p>}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="drawer__body">
          {view.status === 'finished' && <a href="/season">Season standings</a>}
          {view.results && <Settlement view={view} />}
          {view.ledger.length === 0 ? (
            <p className="drawer__note">Buy-ins, rebuys and results show up here once players sit down.</p>
          ) : (
            <table className="ledger">
              <thead>
                <tr><th scope="col">Player</th><th scope="col">In</th><th scope="col">Now</th><th scope="col">Net</th></tr>
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
                  <th scope="row">Table</th>
                  <td>{formatChips(view.ledger.reduce((s, r) => s + r.buyIn, 0))}</td>
                  <td>{formatChips(view.ledger.reduce((s, r) => s + r.stack + r.cashOut, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          <p className="drawer__note">
            {view.settings.rules.cashOut
              ? '“Now” is chips on the table plus anything cashed out. Chips in a live pot count once the hand ends.'
              : 'No cash-outs in this game: a player who leaves after the start loses their chips. Chips in a live pot count once the hand ends.'}
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
      <h3 className="drawer__h">Settlement</h3>
      <p className="drawer__note">
        {r.entries} buy-ins{r.rebuys ? ` + ${r.rebuys} rebuy${r.rebuys > 1 ? 's' : ''}` : ''}{r.addOns ? ` + ${r.addOns} add-on${r.addOns > 1 ? 's' : ''}` : ''} = <b>{formatChips(r.pool)} {cur}</b>.
        Buy-ins go to 1st place. Rebuys rotate over the top {r.places.length}: 1st rebuy to 1st, 2nd to 2nd, and so on.
      </p>
      <ol className="settle__places">
        {r.places.map((pl) => (
          <li key={pl.place}>
            <span className="settle__place">{pl.place}</span>
            <span className="settle__who">{pl.name ?? (done ? '—' : 'Still playing')}</span>
            <span className="settle__prize">{formatChips(pl.prize)} {cur}</span>
          </li>
        ))}
      </ol>
      {done && (
        <table className="ledger">
          <thead><tr><th scope="col">Player</th><th scope="col">Paid</th><th scope="col">Won</th><th scope="col">Net</th></tr></thead>
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
      <p className="drawer__note">The app only works out who owes what. Settle up between yourselves.</p>
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
          <h3 className="drawer__h">Waiting to sit</h3>
          {pending.map((p) => (
            <div className="plist__row" key={p.id}>
              <span className="plist__name">{p.name}<span className="plist__sub">Seat {p.requestedSeat} · {formatChips(p.requestedBuyIn)}</span></span>
              <button className="btn btn--act btn--sm" onClick={() => run('host:approve', p.id)}><Check size={14} /> Seat</button>
              <button className="btn btn--quiet btn--sm" onClick={() => run('host:reject', p.id)}>Decline</button>
            </div>
          ))}
        </section>
      )}

      <section className="plist">
        <h3 className="drawer__h">At the table</h3>
        {seated.length === 0 && <p className="drawer__note">Nobody is seated yet.</p>}
        {seated.map((p) => (
          <div className="plist__item" key={p.id}>
            <div className="plist__row">
              <span className="plist__name">
                {p.name}
                <span className="plist__sub">Seat {p.seat} · {formatChips(p.stack)}{p.isHost ? ' · host' : ''}{!p.connected ? ' · away' : ''}</span>
              </span>
              {isHost && (
                <button className="btn btn--quiet btn--sm" aria-expanded={editing === p.id} onClick={() => { setEditing(editing === p.id ? null : p.id); setStack(String(p.stack)); }}>
                  Manage
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
                  <button className="btn btn--quiet btn--sm">Set stack</button>
                </form>
                <p className="field__hint">Changes count as a buy-in adjustment in the ledger.</p>
                {!p.isHost && (
                  <div className="plist__actions">
                    <button className="btn btn--quiet btn--sm" onClick={() => run('host:transfer', p.id)}>Make host</button>
                    <button className="btn btn--danger btn--sm" onClick={() => run('host:kick', p.id)}>{cashOut ? 'Remove and cash out' : 'Remove (chips go out of play)'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      {me && (
        <section className="plist">
          <h3 className="drawer__h">You</h3>
          <form className="inline" onSubmit={(e) => { e.preventDefault(); void run('player:rename', rename); }}>
            <label className="field field--inline">
              <span className="field__label">Name</span>
              <input value={rename} onChange={(e) => setRename(e.target.value)} maxLength={18} />
            </label>
            <button className="btn btn--quiet btn--sm" disabled={rename.trim() === me.name}>Rename</button>
          </form>
          {me.status !== 'watching' && (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => {
                if (me.status === 'seated' && !cashOut && !window.confirm(`Leave the table? Your ${formatChips(me.stack)} in chips go out of play. You can sit out instead.`)) return;
                void run('seat:leave');
              }}
            >
              {me.status === 'pending' ? 'Cancel seat request' : cashOut ? `Leave seat and cash out ${formatChips(me.stack)}` : 'Leave the table (chips stay out of play)'}
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
                <span>Level {i + 1}</span>
                <span>{formatChips(l.sb)} / {formatChips(l.bb)}{l.ante ? ` · ${formatChips(l.ante)}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
        {r.rebuy.enabled && (
          <p className="drawer__note">
            Rebuys{r.rebuy.amount ? ` of ${formatChips(r.rebuy.amount)}` : ''}
            {r.rebuy.maxStackToRebuy === 0 ? ' when you are out of chips' : r.rebuy.maxStackToRebuy > 0 ? ` at ${formatChips(r.rebuy.maxStackToRebuy)} or less` : ' between hands'}
            {timed && r.rebuy.untilLevel ? `, through level ${r.rebuy.untilLevel}` : ''}
            {r.rebuy.maxPerPlayer ? `, up to ${r.rebuy.maxPerPlayer} per player` : ''}.
          </p>
        )}
        {timed && r.addOn.enabled && <p className="drawer__note">Add-on of {formatChips(r.addOn.amount)} in levels {r.addOn.atLevel}–{r.addOn.atLevel + 1}.</p>}
      </div>
    );
  }

  return (
    <div className="drawer__body">
      <label className="field">
        <span className="field__label">Table name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <RulesPicker value={draft} onChange={(v) => { setDraft(v); setSaved(false); }} currentLevel={view.clock.levelIndex} />
      <label className="toggle">
        <input type="checkbox" checked={approval} onChange={(e) => { setApproval(e.target.checked); setSaved(false); }} />
        <span className="toggle__track" aria-hidden="true" />
        Approve players before they sit
      </label>
      <div className="rules__row">
        <button className="btn btn--act btn--sm" onClick={async () => { await run('host:settings', { name, requireApproval: approval, rules: draft }); setSaved(true); }}>
          Apply to this table
        </button>
        {saved && <span className="picker__status" role="status">Applied. New blinds take effect from the next hand.</span>}
      </div>
      {timed && (
        <div className="rules__row">
          <span className="field__label">Clock</span>
          <button className="btn btn--quiet btn--sm" disabled={view.clock.levelIndex === 0} onClick={() => run('host:level', view.clock.levelIndex - 1)}>Previous level</button>
          <button className="btn btn--quiet btn--sm" onClick={() => run('host:level', view.clock.levelIndex + 1)}>Next level</button>
        </div>
      )}
      <div className="rules__row rules__row--end">
        <button
          className="btn btn--danger btn--sm"
          onClick={() => { if (window.confirm('Close this table for everyone? The ledger is deleted too.')) void run('host:close'); }}
        >
          Close table
        </button>
      </div>
    </div>
  );
}
