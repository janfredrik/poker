// AI-dealer: plays her lines through the shared AudioContext and reports a mouth shape (0 closed, 1 half, 2 open).
import { useCallback, useEffect, useRef, useState } from 'react';
import { sharedAudio } from '../lib/sound';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useDealerVoice() {
  const [mouth, setMouth] = useState<0 | 1 | 2>(0);
  const [speaking, setSpeaking] = useState(false);
  const current = useRef<AudioBufferSourceNode | null>(null);
  const raf = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    try { current.current?.stop(); } catch { /* already stopped */ }
    current.current = null;
    setMouth(0);
    setSpeaking(false);
  }, []);

  useEffect(() => stop, [stop]);

  /** Resolves once the line has finished (or could not be played). */
  const play = useCallback(async (url: string): Promise<boolean> => {
    const ctx = sharedAudio();
    if (!ctx) return false;
    // Suspended (or "interrupted" in Safari) after a while in the background: try to wake it.
    if (ctx.state !== 'running') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
      if ((ctx.state as AudioContextState) !== 'running') { console.warn('[dealer] lyd er blokkert av nettleseren til du klikker på siden'); return false; }
    }
    let buffer: AudioBuffer;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn(`[dealer] fant ikke lyden (HTTP ${res.status})`); return false; }
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) { console.warn('[dealer] kunne ikke spille lyden:', e); return false; }
    stop();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser).connect(ctx.destination);
    current.current = src;
    setSpeaking(true);
    const still = reducedMotion();
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / data.length) / 128;
      setMouth(rms > 0.12 ? 2 : rms > 0.04 ? 1 : 0);
      raf.current = requestAnimationFrame(loop);
    };
    if (!still) raf.current = requestAnimationFrame(loop);
    return new Promise((resolve) => {
      src.onended = () => {
        if (current.current === src) stop();
        resolve(true);
      };
      src.start();
    });
  }, [stop]);

  return { mouth, speaking, play, stop };
}
