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

/** A low, soft double thump, repeated while an all-in runs out. */
export function heartbeatSound() {
  unlockAudio();
  tone(150, 0, 0.14, 0.05);
  tone(128, 0.17, 0.18, 0.04);
}

/** A card snapped face up. */
export function flipSound() {
  unlockAudio();
  tone(1900, 0, 0.03, 0.03);
  tone(950, 0.02, 0.07, 0.025);
}

/** The light switch over a seat going off. */
export function switchOffSound() {
  unlockAudio();
  tone(2600, 0, 0.02, 0.03);
  tone(420, 0.02, 0.09, 0.02);
}

/** Four rising notes for a hand you see once in a long evening. */
export function rareHandSound() {
  unlockAudio();
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.7 + i * 0.1, 0.035));
}
