/**
 * AI-dealer: what the brain is allowed to know. Built only from the public projection
 * `t.view(null)`, the same thing a spectator sees, so hidden hole cards can never leak.
 * Never read `t.hand` here.
 */
import { formatChips as fc } from '../../shared/presets';
import type { TableView } from '../../shared/types';
import type { Table } from '../table';

export function publicView(t: Table): TableView {
  return t.view(null);
}

export function buildContext(v: TableView): string {
  const lines: string[] = [];
  const r = v.settings.rules;
  lines.push(`Bord: ${v.settings.name}. Status: ${v.status}. ${r.levelMinutes > 0 ? 'Turnering' : 'Cash game'}, blinds ${fc(v.clock.level.sb)}/${fc(v.clock.level.bb)}${v.clock.level.ante ? ` ante ${fc(v.clock.level.ante)}` : ''}${v.clock.onBreak ? ', pause nå' : ''}.`);
  const seated = v.players.filter((p) => p.status === 'seated').sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  lines.push('Spillere:');
  for (const p of seated) {
    const tags = [
      p.place != null ? `${p.place}. plass` : null,
      p.sittingOut ? 'står over' : null,
      p.folded ? 'har foldet' : null,
      p.allIn ? 'all-in' : null,
      p.bet ? `innsats ${fc(p.bet)}` : null,
      p.shownCards ? `viste ${p.shownCards.join(' ')}` : null,
      p.rebuys ? `${p.rebuys} rebuy` : null,
    ].filter(Boolean);
    lines.push(`- ${p.name}: ${fc(p.stack)} chips${tags.length ? ` (${tags.join(', ')})` : ''}`);
  }
  const h = v.hand;
  if (h) {
    const pot = h.potTotal + v.players.reduce((s, p) => s + p.bet, 0);
    lines.push(`Hånd nr. ${h.number}, ${h.street}. Bord: ${h.board.length ? h.board.join(' ') : 'ingen kort ennå'}. Pot: ${fc(pot)}.`);
    if (h.winners) lines.push(`Vinnere: ${h.winners.map((w) => `${v.players.find((p) => p.id === w.playerId)?.name ?? '?'} ${fc(w.amount)}${w.hand ? ` med ${w.hand}` : ''}`).join(', ')}.`);
  }
  const log = v.log.slice(-14).map((e) => (e.kind === 'chat' ? `${e.by}: «${e.text}»` : e.text));
  if (log.length) lines.push('Siste i loggen:', ...log.map((l) => `- ${l}`));
  return lines.join('\n');
}
