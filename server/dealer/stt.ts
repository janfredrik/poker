/** AI-dealer: Azure Speech-to-Text, short-audio REST (up to 60 s of 16 kHz mono WAV). */
import { dealerConfig } from './config';

export async function transcribe(wav: Buffer): Promise<string | null> {
  const c = dealerConfig();
  if (!c.azureKey || !c.azureRegion) return null;
  try {
    const url = `https://${encodeURIComponent(c.azureRegion)}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=nb-NO&format=simple&profanity=raw`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': c.azureKey, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' },
      body: new Uint8Array(wav),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json() as { RecognitionStatus?: string; DisplayText?: string };
    return body.RecognitionStatus === 'Success' ? body.DisplayText?.trim() || null : null;
  } catch (e) {
    console.warn('[dealer] speech-to-text failed:', (e as Error).message);
    return null;
  }
}
