# AI-dealer

En valgfri, tegnet dealer øverst på bordet. Hun kommenterer spillet med stemme og svarer når spillere snakker til henne. Hun ser bare det alle ved bordet ser (den offentlige visningen, aldri skjulte hullkort), kan ikke gjøre noe i spillet, og er av som standard.

- **Rutine** (spillstart, nye blinds, pause, iblant flop/turn/river): faste replikker. Lyden lages én gang og lagres i `DATA_DIR/dealer/`.
- **Noen setter seg**: «Velkommen til bordet, Kari.» Én gang per spiller (ikke ved rebuy eller nytt sete), flere samtidig får én hilsen. Er navnet vanskelig å lese opp (tall, tegn, emoji, bokstavsuppe, mer enn tre ord), sier hun bare «Velkommen til bordet.» Lyden lagres per navn som de faste replikkene.
- **Store øyeblikk** (all-in, showdown, tom for chips, utslått, turneringsseier): fersk replikk fra OpenRouter, lest opp med ElevenLabs eller Azure. Minst 20 s mellom ferske replikker og maks `DEALER_MAX_PER_HOUR` per bord i timen; ellers brukes en fast replikk. En fersk replikk som kommer mer enn 6 s for sent, eller etter at en ny hånd har startet, kastes.
- **Snakk med henne**: hold «Dealer»-knappen (eller `T`) og snakk. Maks 15 s, én gang per spiller per 10 s. Krever Azure Speech.
- Hver spiller kan slå av stemmen for seg selv ved å klikke på henne. Snakkeboblen vises fortsatt.
- Verten slår henne på i lobbyen før spillet starter. Aldri på demobord.

## Oppsett

1. **OpenRouter**: lag en nøkkel på openrouter.ai → `OPENROUTER_API_KEY`. Standardmodell er `anthropic/claude-haiku-5.5`; bytt med `DEALER_MODEL`.
2. **ElevenLabs**: lag en API-nøkkel → `ELEVENLABS_API_KEY`. Velg en kvinnestemme og kopier stemme-ID-en → `ELEVENLABS_VOICE_ID`. **Gratisplanen kan ikke bruke stemmer fra Voice Library via API-et** (feil 402 `paid_plan_required` i loggen); bruk da en av standardstemmene (de leser norsk med v4-modellene), eller oppgrader til Starter for å bruke en norsk stemme fra biblioteket. Nøkkelen trenger bare tilgang til Text to Speech. Modellene er `eleven_v4_turbo` (ferske replikker) og `eleven_v4` (faste replikker), kan overstyres med `ELEVENLABS_MODEL_LIVE` / `ELEVENLABS_MODEL_FIXED`.
3. **Azure Speech** (for push-to-talk, og kan være stemmen hennes): lag en Speech-ressurs i Azure → `AZURE_SPEECH_KEY` og `AZURE_SPEECH_REGION` (f.eks. `norwayeast`). Gratisnivået (F0) har 0,5 millioner tegn tekst-til-tale i måneden.

**Stemme:** ElevenLabs brukes hvis den er satt opp, ellers Azure. Sett `DEALER_VOICE=azure` for å bruke Azure selv om ElevenLabs-nøklene står der. Azure-stemmen er `nb-NO-PernilleNeural`; `AZURE_TTS_VOICE=nb-NO-IselinNeural` er den andre norske kvinnestemmen. Du trenger altså bare OpenRouter + Azure for at hun skal snakke og lytte.
4. Fyll inn i `.env` og start containeren på nytt. Uten OpenRouter og en stemme (2 eller 3) finnes ikke dealeren i det hele tatt: ingen bryter, ingen rute, ingen knapp.

Bytter du stemme eller modell, lages de faste replikkene på nytt ved første bruk. Gamle filer i `DATA_DIR/dealer/` kan slettes.

## Fjerne henne

1. Slett `server/dealer/` og `client/src/dealer/`.
2. Kjør `grep -rn "AI-dealer" --exclude-dir=node_modules --exclude-dir=dist .` og fjern hver merket linje (og den merkede blokken i `server/selftest.ts`, `docker-compose.yml`, `.env.example`, og avsnittet i `CLAUDE.md`).
3. Fjern miljøvariablene fra README, `.env` og `docker-compose.yml`.
4. Slett `DATA_DIR/dealer/` og denne filen.
5. `npm run typecheck && npm test`.

`dealer: true` kan bli liggende i lagrede bord; feltet ignoreres når koden er borte.
