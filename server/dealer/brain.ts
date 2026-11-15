/** AI-dealer: fresh lines from an OpenRouter chat model. */
import { dealerConfig } from './config';

const SYSTEM = `Du er dealeren ved et hjemmespill i No-Limit Texas Hold'em blant venner, spilt med lekepenger.
Stil: lun og tørrvittig, varm under overflaten, aldri slem. Du snakker norsk bokmål og bruker etablerte engelske pokertermer (flop, turn, river, all-in, showdown, pot, blinds, stack).
Svar med høyst to korte setninger. Ingen emojier, ingen anførselstegn, ingen lister – teksten leses høyt.
Du vet bare det som står i bordbeskrivelsen. Du ser aldri skjulte hullkort og gjetter aldri på hva noen har på hånden.
Du kan ikke gjøre noe i spillet: ikke dele kort, flytte sjetonger, endre regler eller handle for noen. Blir du bedt om det, sier du vennlig nei.
Ikke gi strategiråd om hva noen bør gjøre i en hånd som pågår. Ikke snakk om ekte penger eller gambling.`;

export async function askBrain(context: string, task: string): Promise<string | null> {
  const c = dealerConfig();
  if (!c.openRouterKey) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.openRouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'Hjemmespill dealer' },
      body: JSON.stringify({
        model: c.model,
        max_tokens: 120,
        temperature: 0.9,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Bordet nå:\n${context}\n\n${task}` },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    return tidy(body.choices?.[0]?.message?.content ?? '');
  } catch (e) {
    console.warn('[dealer] brain failed:', (e as Error).message);
    return null;
  }
}

/** At most two sentences, no stray quotes or markup, capped in length. */
export function tidy(text: string): string | null {
  const flat = text.replace(/[*_#`"«»]/g, '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const sentences = flat.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [flat];
  const out = sentences.slice(0, 2).join('').trim();
  return out.length > 240 ? `${out.slice(0, 237).replace(/\s+\S*$/, '')} …` : out;
}
