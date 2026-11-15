let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, gain = 0.06) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function unlockAudio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { ctx = null; }
  }
  if (ctx?.state === 'suspended') void ctx.resume();
}

/** The shared audio context (created on first use), or null where Web Audio is missing. */
export function sharedAudio(): AudioContext | null { unlockAudio(); return ctx; } // AI-dealer

/** Two soft notes: it's your turn. */
export function yourTurnSound() {
  unlockAudio();
  tone(660, 0, 0.18);
  tone(880, 0.12, 0.25);
}

/** A short click, like a chip landing. */
export function chipSound() {
  unlockAudio();
  tone(2200, 0, 0.04, 0.025);
  tone(1600, 0.03, 0.05, 0.02);
}
