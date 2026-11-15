/**
 * AI-dealer: ElevenLabs text-to-speech. Fixed lines are voiced once and kept on disk under
 * DATA_DIR/dealer/, keyed by a hash of model + voice + text. Fresh lines stay in memory for two minutes.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dealerConfig } from './config';

const FRESH_MS = 2 * 60 * 1000;
const fresh = new Map<string, { audio: Buffer; expires: number }>();
/** Fixed lines being voiced right now, so two tables don't pay for the same line twice. */
const making = new Map<string, Promise<string | null>>();

export const AUDIO_ID = /^[a-f0-9]{32}$/;

async function synth(text: string, model: string): Promise<Buffer | null> {
  const c = dealerConfig();
  if (!c.elevenKey || !c.voiceId) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.voiceId)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': c.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn('[dealer] speech failed:', (e as Error).message);
    return null;
  }
}

/** Audio id for a fixed line, voiced on first use. */
export function fixedAudio(text: string): Promise<string | null> {
  const c = dealerConfig();
  const id = createHash('sha256').update(`${c.modelFixed}\n${c.voiceId}\n${text}`).digest('hex').slice(0, 32);
  if (existsSync(join(c.dir, `${id}.mp3`))) return Promise.resolve(id);
  const busy = making.get(id);
  if (busy) return busy;
  const p = synth(text, c.modelFixed).then((audio) => {
    if (!audio) return null;
    mkdirSync(c.dir, { recursive: true });
    const file = join(c.dir, `${id}.mp3`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, audio);
    renameSync(tmp, file);
    return id;
  }).finally(() => making.delete(id));
  making.set(id, p);
  return p;
}

/** Audio id for a fresh line, kept in memory for a couple of minutes. */
export async function freshAudio(text: string): Promise<string | null> {
  const audio = await synth(text, dealerConfig().modelLive);
  if (!audio) return null;
  const now = Date.now();
  for (const [k, v] of fresh) if (v.expires < now) fresh.delete(k);
  const id = randomBytes(16).toString('hex');
  fresh.set(id, { audio, expires: now + FRESH_MS });
  return id;
}

export function readAudio(id: string): Buffer | null {
  if (!AUDIO_ID.test(id)) return null;
  const f = fresh.get(id);
  if (f && f.expires > Date.now()) return f.audio;
  const file = join(dealerConfig().dir, `${id}.mp3`);
  return existsSync(file) ? readFileSync(file) : null;
}
