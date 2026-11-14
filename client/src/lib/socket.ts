import { io, type Socket } from 'socket.io-client';

export const socket: Socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

type AckRes<T> = { ok: true; data?: T } | { ok: false; error: string };

/** Emit with acknowledgement; rejects with the server's human-readable error. */
export function call<T = unknown>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Serveren svarte ikke. Sjekk tilkoblingen din.')), 8000);
    socket.emit(event, payload, (res: AckRes<T>) => {
      clearTimeout(timer);
      if (res?.ok) resolve(res.data as T);
      else reject(new Error(res?.error ?? 'Noe gikk galt.'));
    });
  });
}

const key = (tableId: string) => `homegame:token:${tableId}`;
export const tokens = {
  get(tableId: string): string | null {
    try { return localStorage.getItem(key(tableId)); } catch { return null; }
  },
  set(tableId: string, token: string) {
    try { localStorage.setItem(key(tableId), token); } catch { /* private mode */ }
  },
};

export const prefs = {
  get(name: string, fallback = ''): string {
    try { return localStorage.getItem(`homegame:${name}`) ?? fallback; } catch { return fallback; }
  },
  set(name: string, value: string) {
    try { localStorage.setItem(`homegame:${name}`, value); } catch { /* ignore */ }
  },
};
