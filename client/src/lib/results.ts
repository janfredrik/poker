import { formatChips } from '../../../shared/presets';
import type { TableView } from '../../../shared/types';

export function formatResults(view: TableView): string {
  const { results } = view;
  const ranked = view.players.filter((p) => p.place != null).sort((a, b) => a.place! - b.place!);
  const lines = [view.settings.name];
  if (results) {
    const entries = [`${results.entries} buy-ins`];
    if (results.rebuys) entries.push(`${results.rebuys} rebuy${results.rebuys === 1 ? '' : 's'}`);
    if (results.addOns) entries.push(`${results.addOns} add-on${results.addOns === 1 ? '' : 's'}`);
    lines.push(`${entries.join(' + ')} · ${formatChips(results.pool)} ${results.currency}`);
  }
  lines.push('', 'Final standings');
  const debtors: { name: string; amount: number }[] = [];
  const creditors: { name: string; amount: number }[] = [];

  for (const player of ranked) {
    const prize = results?.places.find((p) => p.playerId === player.id)?.prize ?? 0;
    const award = prize && results ? ` · ${formatChips(prize)} ${results.currency}` : '';
    lines.push(`${player.place}. ${player.name}${award}`);
    if (!results) continue;

    const duplicate = ranked.some((p) => p.id !== player.id && p.name === player.name);
    const name = duplicate ? `${player.name} (#${player.place})` : player.name;
    const net = prize - results.paid[player.id];
    if (net < 0) debtors.push({ name, amount: -net });
    if (net > 0) creditors.push({
      name: player.id === view.you.playerId ? `me (${name})` : name,
      amount: net,
    });
  }

  if (results) {
    lines.push('', 'Settlement');
    const owed = debtors.reduce((sum, p) => sum + p.amount, 0);
    const due = creditors.reduce((sum, p) => sum + p.amount, 0);
    if (owed !== due || ranked.length !== results.entries) {
      return [...lines, 'Check the ledger for the final settlement.'].join('\n');
    }
    if (!debtors.length) lines.push('All square.');
    let nextCreditor = 0;
    for (const debtor of debtors) {
      while (debtor.amount > 0) {
        const creditor = creditors[nextCreditor];
        const amount = Math.min(debtor.amount, creditor.amount);
        lines.push(`${debtor.name} pays ${creditor.name} ${formatChips(amount)} ${results.currency}`);
        debtor.amount -= amount;
        creditor.amount -= amount;
        if (creditor.amount === 0) nextCreditor++;
      }
    }
  }
  return lines.join('\n');
}
