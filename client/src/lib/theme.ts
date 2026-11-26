import { useEffect, useState } from 'react';
import { prefs } from './socket';

/** The room around the table. Each person picks their own; it is stored in this browser only. */
export const ROOMS = [
  { id: 'valnott', name: 'Valnøtt', hint: 'Mørk', swatch: '#3b2a20', bar: '#1d1510' },
  { id: 'skifer', name: 'Skifer', hint: 'Mørk, kald', swatch: '#273038', bar: '#13181c' },
  { id: 'eik', name: 'Lys eik', hint: 'Lys', swatch: '#d8c3a0', bar: '#efe7d8' },
] as const;

export type RoomId = (typeof ROOMS)[number]['id'];
export interface Theme { room: RoomId }

const isRoom = (v: string): v is RoomId => ROOMS.some((r) => r.id === v);

export function loadTheme(): Theme {
  const room = prefs.get('room');
  return { room: isRoom(room) ? room : 'valnott' };
}

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.dataset.room = t.room;
  const room = ROOMS.find((r) => r.id === t.room)!;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', room.bar);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', t.room === 'eik' ? 'light' : 'dark');
}

const listeners = new Set<(t: Theme) => void>();

export function setTheme(t: Theme) {
  prefs.set('room', t.room);
  applyTheme(t);
  listeners.forEach((fn) => fn(t));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState(loadTheme);
  useEffect(() => {
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, []);
  return [theme, setTheme];
}
