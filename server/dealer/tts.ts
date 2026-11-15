/**
 * AI-dealer: text-to-speech with ElevenLabs or Azure. Fixed lines are voiced once and kept on disk under
 * DATA_DIR/dealer/, keyed by a hash of provider + model + voice + text. Fresh lines stay in memory for two minutes.
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

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function synthAzure(text: string, timeoutMs: number): Promise<Buffer | null> {
  const c = dealerConfig();
  if (!c.azureKey || !c.azureRegion) return null;
  try {
    const res = await fetch(`https://${encodeURIComponent(c.azureRegion)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': c.azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'homegame-dealer',
      },
      body: `<speak version="1.0" xml:lang="nb-NO"><voice name="${xml(c.azureVoice)}">${xml(text)}</voice></speak>`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn('[dealer] speech failed (Azure):', (e as Error).message);
    return null;
  }
}

async function synth(text: string, model: string, timeoutMs: number): Promise<Buffer | null> {
  const c = dealerConfig();
  if (c.tts === 'azure') return synthAzure(text, timeoutMs);
  if (!c.elevenKey || !c.voiceId) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.voiceId)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': c.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, language_code: 'no' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      if (body.includes('paid_plan_required')) throw new Error('HTTP 402: gratisplanen kan ikke bruke stemmer fra Voice Library via API-et. Velg en av standardstemmene, eller oppgrader.');
      throw new Error(`HTTP ${res.status} ${body}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn('[dealer] speech failed:', (e as Error).message);
    return null;
  }
}

/** Audio id for a fixed line, voiced on first use. */
export function fixedAudio(text: string): Promise<string | null> {
  const c = dealerConfig();
  const voice = c.tts === 'azure' ? `azure\n${c.azureVoice}` : `${c.modelFixed}\n${c.voiceId}`;
  const id = createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 32);
  if (existsSync(join(c.dir, `${id}.mp3`))) return Promise.resolve(id);
  const busy = making.get(id);
  if (busy) return busy;
  // Not in a hurry: a late fixed line is skipped this time but kept for the next.
  const p = synth(text, c.modelFixed, 30_000).then((audio) => {
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
  const audio = await synth(text, dealerConfig().modelLive, 10_000);
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
