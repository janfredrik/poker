// AI-dealer: hold to talk to the dealer (button or the T key). Records 16 kHz mono WAV, at most 15 s.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import type { TableView } from '../../../shared/types';
import { mesh } from '../lib/media';
import { sharedAudio } from '../lib/sound';
import { call } from '../lib/socket';
import { useDealerInfo } from './info';

const RATE = 16000;
const MAX_MS = 15_000;
const MIN_MS = 400;

interface Recording { stop: () => Promise<Blob | null> }

async function startRecording(): Promise<Recording> {
  const ctx = sharedAudio();
  if (!ctx) throw new Error('Nettleseren kan ikke ta opp lyd.');
  if (ctx.state !== 'running') await ctx.resume();
  // Reuse the mic that already feeds video (a clone, unmuted), or ask for one just for this.
  const shared = mesh.getSnapshot().local?.getAudioTracks().find((t) => t.readyState === 'live');
  let track: MediaStreamTrack;
  if (shared) { track = shared.clone(); track.enabled = true; }
  else {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofonen krever en sikker tilkobling (HTTPS).');
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    track = s.getAudioTracks()[0];
  }
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  const started = performance.now();
  proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  source.connect(proc).connect(silent).connect(ctx.destination);
  return {
    stop: async () => {
      proc.onaudioprocess = null;
      source.disconnect(); proc.disconnect(); silent.disconnect();
      track.stop();
      if (performance.now() - started < MIN_MS) return null;
      return encodeWav(chunks, ctx.sampleRate);
    },
  };
}

function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { input.set(c, o); o += c.length; }
  const ratio = rate / RATE;
  const n = Math.min(Math.floor(total / ratio), RATE * (MAX_MS / 1000));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // average the source samples that fall in this output sample
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b && j < total; j++) sum += input[j];
    const s = Math.max(-1, Math.min(1, sum / (b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function DealerTalkButton({ view }: { view: TableView }) {
  const info = useDealerInfo();
  const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout>>();
  const active = useRef(false);
  const me = view.players.find((p) => p.id === view.you.playerId);
  const show = info.canListen && !!view.settings.dealer && me?.status === 'seated';

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(limit.current);
      void rec.current?.stop();
      rec.current = null;
    };
  }, []);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3500); return () => clearTimeout(t); }, [note]);

  const finish = useCallback(async () => {
    clearTimeout(limit.current);
    await starting.current;
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    const wav = await r.stop();
    if (!wav) { setState('idle'); setNote('Hold knappen inne mens du snakker.'); return; }
    setState('sending');
    try {
      const audio = await wav.arrayBuffer();
      if (!active.current) return;
      const res = await call<{ heard: string }>('dealer:ask', audio);
      setNote(`«${res.heard}»`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setState('idle');
    }
  }, []);

  const begin = useCallback(() => {
    if (rec.current || starting.current || state === 'sending') return;
    setState('recording');
    setNote(null);
    starting.current = startRecording()
      .then((r) => {
        if (!active.current) { void r.stop(); return; }
        rec.current = r;
        limit.current = setTimeout(() => void finish(), MAX_MS);
      })
      .catch((e: Error) => {
        setState('idle');
        setNote(e.name === 'NotAllowedError' ? 'Nettleseren har blokkert mikrofonen.' : e.message || 'Fant ingen mikrofon.');
      })
      .finally(() => { starting.current = null; });
  }, [state, finish]);

  // hold T to talk
  useEffect(() => {
    if (!show) return;
    const typing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey;
    };
    const down = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 't' && !e.repeat && !typing(e)) { e.preventDefault(); begin(); } };
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 't') void finish(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [show, begin, finish]);

  if (!show) return null;
  return (
    <button
      className={`chipbtn dealer-talk ${state === 'recording' ? 'is-recording' : ''}`}
      disabled={state === 'sending'}
      aria-pressed={state === 'recording'}
      title={note ?? 'Hold inne (eller hold T) og snakk til dealeren'}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
      onPointerUp={() => void finish()}
      onPointerCancel={() => void finish()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') void finish(); }}
    >
      {state === 'recording' ? <span className="dealer-talk__dot" aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
      <span aria-live="polite">{state === 'recording' ? 'Lytter …' : state === 'sending' ? 'Sender …' : note ?? 'Dealer'}</span>
    </button>
  );
}
