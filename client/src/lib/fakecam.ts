// A drawn "webcam" for demo bots: a cartoon person in a room, rendered to a canvas and captured as a MediaStream,
// so a bot's seat goes through the same <video> path as a real player's camera.

const W = 320;
const H = 240;
const FPS = 15;

const SKIN = ['#f1c7a5', '#e0ac82', '#c68b5e', '#a26a43', '#7a4a2c', '#f5d6bd'];
const HAIR = ['#2b1d14', '#5a3a22', '#8a5a2b', '#c9a15a', '#1a1a1a', '#7d7064', '#a2442a'];
const SHIRT = ['#2f5fa8', '#c8372d', '#2f7d4a', '#3b3f46', '#8a6db1', '#d08a2e', '#e9e0cc', '#1f6f78'];
const WALL = [[30, 40, 52], [52, 38, 30], [38, 48, 40], [58, 50, 44], [34, 34, 46], [48, 36, 44]];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Look {
  skin: string; hair: string; shirt: string; wall: number[];
  hairStyle: 0 | 1 | 2 | 3; glasses: boolean; beard: boolean;
  lampX: number; phase: number; frameX: number;
}

function lookFor(name: string): Look {
  const r = rng(hash(name));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRT), wall: pick(WALL),
    hairStyle: Math.floor(r() * 4) as Look['hairStyle'], glasses: r() < 0.3, beard: r() < 0.3,
    lampX: r() < 0.5 ? 0.15 + r() * 0.2 : 0.65 + r() * 0.2, phase: r() * 100, frameX: 0.1 + r() * 0.8,
  };
}

function draw(g: CanvasRenderingContext2D, k: Look, time: number, state: { blinkAt: number; lookAt: number; look: number; talkUntil: number }) {
  const t = time / 1000 + k.phase;
  const [wr, wg, wb] = k.wall;

  // room
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `rgb(${wr + 18},${wg + 16},${wb + 14})`);
  bg.addColorStop(1, `rgb(${wr - 10},${wg - 10},${wb - 10})`);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const lamp = g.createRadialGradient(W * k.lampX, H * 0.2, 4, W * k.lampX, H * 0.2, W * 0.55);
  lamp.addColorStop(0, 'rgba(255,205,140,0.45)');
  lamp.addColorStop(1, 'rgba(255,205,140,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);
  // a picture frame on the wall, out of focus
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(W * k.frameX - 34, 26, 68, 50);
  g.fillStyle = `rgba(${wr + 50},${wg + 46},${wb + 40},0.35)`;
  g.fillRect(W * k.frameX - 28, 32, 56, 38);

  // gentle sway; now and then glance to the side
  if (time > state.lookAt) { state.look = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1); state.lookAt = time + 1500 + Math.random() * 4000; }
  if (time > state.talkUntil + 2500 && Math.random() < 0.004) state.talkUntil = time + 1200 + Math.random() * 2000;
  const sway = Math.sin(t * 0.7) * 6 + Math.sin(t * 1.9) * 2;
  const bob = Math.sin(t * 1.3) * 2.5;
  const cx = W / 2 + sway;
  const cy = H * 0.47 + bob;

  // shoulders
  g.fillStyle = k.shirt;
  g.beginPath();
  g.moveTo(cx - 120, H + 10);
  g.bezierCurveTo(cx - 118, cy + 70, cx - 70, cy + 58, cx - 26, cy + 56);
  g.lineTo(cx + 26, cy + 56);
  g.bezierCurveTo(cx + 70, cy + 58, cx + 118, cy + 70, cx + 120, H + 10);
  g.closePath();
  g.fill();
  // neck
  g.fillStyle = k.skin;
  g.fillRect(cx - 15, cy + 30, 30, 30);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(cx - 15, cy + 30, 30, 10);

  const hx = cx + state.look * 4;
  // hair behind the head (long style)
  g.fillStyle = k.hair;
  if (k.hairStyle === 2) {
    g.beginPath();
    g.ellipse(hx, cy + 6, 50, 62, 0, 0, Math.PI * 2);
    g.fill();
  }
  // head
  g.fillStyle = k.skin;
  g.beginPath();
  g.ellipse(hx, cy, 40, 50, 0, 0, Math.PI * 2);
  g.fill();
  // ears
  g.beginPath();
  g.ellipse(hx - 40, cy + 4, 7, 11, 0, 0, Math.PI * 2);
  g.ellipse(hx + 40, cy + 4, 7, 11, 0, 0, Math.PI * 2);
  g.fill();
  // hair on top
  g.fillStyle = k.hair;
  if (k.hairStyle !== 3) {
    g.beginPath();
    g.ellipse(hx, cy - 30, 42, k.hairStyle === 1 ? 30 : 24, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.fillRect(hx - 42, cy - 31, 84, 8);
  }
  if (k.beard) {
    g.beginPath();
    g.ellipse(hx, cy + 30, 30, 20, 0, 0, Math.PI);
    g.fill();
  }

  // eyes
  const blinking = time > state.blinkAt && time < state.blinkAt + 140;
  if (time > state.blinkAt + 140) state.blinkAt = time + 2200 + Math.random() * 4000;
  const ex = state.look * 3;
  for (const dx of [-15, 15]) {
    if (blinking) {
      g.strokeStyle = '#2a1d15'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(hx + dx - 6, cy - 2); g.lineTo(hx + dx + 6, cy - 2); g.stroke();
    } else {
      g.fillStyle = '#f7f3ea';
      g.beginPath(); g.ellipse(hx + dx, cy - 2, 7, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a1d15';
      g.beginPath(); g.arc(hx + dx + ex, cy - 2, 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = k.hair; g.lineWidth = 3;
    g.beginPath(); g.moveTo(hx + dx - 8, cy - 13); g.lineTo(hx + dx + 8, cy - 14); g.stroke();
  }
  if (k.glasses) {
    g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = 2;
    g.strokeRect(hx - 25, cy - 10, 20, 15);
    g.strokeRect(hx + 5, cy - 10, 20, 15);
    g.beginPath(); g.moveTo(hx - 5, cy - 4); g.lineTo(hx + 5, cy - 4); g.stroke();
  }
  // nose
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(hx + ex, cy + 2); g.lineTo(hx + ex - 3, cy + 13); g.lineTo(hx + ex + 2, cy + 14); g.stroke();
  // mouth
  const talking = time < state.talkUntil;
  const open = talking ? 2 + Math.abs(Math.sin(time / 90)) * 5 : 0;
  g.fillStyle = '#7a3a32';
  g.beginPath();
  g.ellipse(hx + ex, cy + 25, 11, 2 + open, 0, 0, Math.PI * 2);
  g.fill();

  // camera feel: vignette and a little sensor noise
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 60; i++) g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
}

const cams = new Map<string, MediaStream>();

/** A looping fake camera stream for a demo bot, created once per player. */
export function fakeCam(playerId: string, name: string): MediaStream | null {
  const cached = cams.get(playerId);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g || typeof canvas.captureStream !== 'function') return null;
  const look = lookFor(name);
  const state = { blinkAt: performance.now() + Math.random() * 3000, lookAt: 0, look: 0, talkUntil: 0 };
  const render = () => draw(g, look, performance.now(), state);
  render();
  setInterval(render, 1000 / FPS);
  const stream = canvas.captureStream(FPS);
  cams.set(playerId, stream);
  return stream;
}
