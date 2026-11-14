import { formatChips } from '../../../shared/presets';
import { rankedResults } from '../../../shared/results';
import type { TableView } from '../../../shared/types';

export function formatResults(view: TableView): string {
  const { results } = view;
  const ranked = rankedResults(view);
  const lines = [view.settings.name];
  if (results) {
    const entries = [`${results.entries} buy-ins`];
    if (results.rebuys) entries.push(`${results.rebuys} rebuy${results.rebuys === 1 ? '' : 's'}`);
    if (results.addOns) entries.push(`${results.addOns} add-on${results.addOns === 1 ? '' : 's'}`);
    lines.push(`${entries.join(' + ')} · ${formatChips(results.pool)} ${results.currency}`);
  }
  lines.push('', 'Sluttresultater');
  const debtors: { name: string; amount: number }[] = [];
  const creditors: { name: string; amount: number }[] = [];

  for (const player of ranked) {
    const { prize, net } = player;
    const award = prize && results ? ` · ${formatChips(prize)} ${results.currency}` : '';
    lines.push(`${player.place}. ${player.name}${award}`);
    if (net == null) continue;

    const duplicate = ranked.some((p) => p.id !== player.id && p.name === player.name);
    const name = duplicate ? `${player.name} (#${player.place})` : player.name;
    if (net < 0) debtors.push({ name, amount: -net });
    if (net > 0) creditors.push({
      name: player.id === view.you.playerId ? `meg (${name})` : name,
      amount: net,
    });
  }

  if (results) {
    lines.push('', 'Oppgjør');
    const owed = debtors.reduce((sum, p) => sum + p.amount, 0);
    const due = creditors.reduce((sum, p) => sum + p.amount, 0);
    if (owed !== due || ranked.length !== results.entries || ranked.some((p) => p.net == null)) {
      return [...lines, 'Se regnskapet for endelig oppgjør.'].join('\n');
    }
    if (!debtors.length) lines.push('Ingen skylder noe.');
    let nextCreditor = 0;
    for (const debtor of debtors) {
      while (debtor.amount > 0) {
        const creditor = creditors[nextCreditor];
        const amount = Math.min(debtor.amount, creditor.amount);
        lines.push(`${debtor.name} betaler ${creditor.name} ${formatChips(amount)} ${results.currency}`);
        debtor.amount -= amount;
        creditor.amount -= amount;
        if (creditor.amount === 0) nextCreditor++;
      }
    }
  }
  return lines.join('\n');
}
