/**
 * AI-dealer: keys and models from the environment. Read on every call (cheap) so the self-test
 * can switch keys on and off. Without OpenRouter + ElevenLabs the dealer does not exist at all.
 */
import { join } from 'node:path';

const env = process.env;
const v = (k: string) => env[k]?.trim() || undefined;

export function dealerConfig() {
  return {
    openRouterKey: v('OPENROUTER_API_KEY'),
    model: v('DEALER_MODEL') ?? 'anthropic/claude-haiku-5.5',
    elevenKey: v('ELEVENLABS_API_KEY'),
    voiceId: v('ELEVENLABS_VOICE_ID'),
    /** Fresh lines, read aloud as soon as they arrive. */
    modelLive: v('ELEVENLABS_MODEL_LIVE') ?? 'eleven_v4_turbo',
    /** Fixed lines, made once and kept on disk. */
    modelFixed: v('ELEVENLABS_MODEL_FIXED') ?? 'eleven_v4',
    azureKey: v('AZURE_SPEECH_KEY'),
    azureRegion: v('AZURE_SPEECH_REGION'),
    dir: join(env.DATA_DIR ?? join(process.cwd(), 'data'), 'dealer'),
  };
}

export function dealerAvailable(): boolean {
  const c = dealerConfig();
  return !!(c.openRouterKey && c.elevenKey && c.voiceId);
}

export function dealerCanListen(): boolean {
  const c = dealerConfig();
  return dealerAvailable() && !!(c.azureKey && c.azureRegion);
}
