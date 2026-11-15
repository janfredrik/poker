// AI-dealer: the host's switch in the lobby, before the game starts.
import { useState } from 'react';
import type { TableView } from '../../../shared/types';
import { call } from '../lib/socket';
import { useDealerInfo } from './info';

export function DealerToggle({ view, onError }: { view: TableView; onError: (msg: string) => void }) {
  const info = useDealerInfo();
  const [busy, setBusy] = useState(false);
  // Demo tables (with bots) never get the dealer.
  if (!info.available || !view.you.isHost || view.status !== 'waiting' || view.players.some((p) => p.bot)) return null;
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={!!view.settings.dealer}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try { await call('dealer:toggle', e.target.checked); } catch (err) { onError((err as Error).message); } finally { setBusy(false); }
        }}
      />
      <span className="toggle__track" aria-hidden="true" />
      AI-dealer som kommenterer spillet
    </label>
  );
}
