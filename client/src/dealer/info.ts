// AI-dealer: whether the server has the dealer set up, asked once per connection.
import { useEffect, useState } from 'react';
import { call, prefs, socket } from '../lib/socket';

export interface DealerInfo { available: boolean; canListen: boolean }
export interface DealerSay { id: string; text: string; audioUrl: string | null; replyTo?: { name: string; text: string } }

const OFF: DealerInfo = { available: false, canListen: false };
let cached: Promise<DealerInfo> | null = null;
socket.on('connect', () => { cached = null; });

export function useDealerInfo(): DealerInfo {
  const [info, setInfo] = useState<DealerInfo>(OFF);
  useEffect(() => {
    let live = true;
    cached ??= call<DealerInfo>('dealer:info').catch(() => { cached = null; return OFF; });
    void cached.then((i) => { if (live) setInfo(i); });
    return () => { live = false; };
  }, []);
  return info;
}

/** Each viewer can silence her voice for themselves; the bubble still shows. */
export const dealerMuted = {
  get: () => prefs.get('dealerMuted') === '1',
  set: (v: boolean) => prefs.set('dealerMuted', v ? '1' : '0'),
};
