# BobaJarvis

Source: https://github.com/Zain-ux-lab/bobajarvis

An earpiece-first voice assistant prototype for a bubble tea shop worker who is working alone. The worker starts a shift once. After that they hear tickets, ask follow-up questions, get measured recipe steps one at a time, complete orders and manage stock by voice, without touching or looking at the screen.

> **Honesty label:** the POS tickets, recipes and inventory are **simulated demo data** held in the browser. Nothing connects to a real shop system; the optional Square integration only talks to Square's free sandbox.

## How it works (one paragraph)

Speech → local Whisper (`/api/transcribe`) → transcript → `/api/jarvis` (LLM turns language into a **validated JSON action plan**) → `executePlan()` (app code changes state, does all arithmetic, writes the factual reply) → browser speech synthesis. Typed test phrases use the same path, starting at `/api/jarvis`. The LLM never edits state and never states quantities. It only picks actions such as `continue_recipe` or `complete_ticket`.

## Project structure

One Next.js project holds both halves. The rule that shapes it: **API keys and model calls live only on the server; the browser only ever sees action plans.**

```
src/
├── app/
│   ├── page.tsx                 FRONT-END  the earpiece screen (pearl, voice state, current drink, last reply)
│   ├── layout.tsx, globals.css  FRONT-END  fonts, colours, and how each voice state looks
│   └── api/                     BACK-END   server endpoints (keys are read here, never sent to the browser)
│       ├── jarvis/route.ts        transcript + shop context -> validated action plan (LLM call)
│       ├── transcribe/route.ts    16 kHz WAV -> text with local Whisper
│       └── square/                optional Square sandbox: import open orders, mark one ready
├── components/
│   └── Drawer.tsx               FRONT-END  "Simulated POS & Inventory" drawer: tickets, stock, recipes, test tools, action log
└── lib/
    ├── earpiece.ts              FRONT-END  voice loop: mic, speech detection, Whisper upload, speaking, interrupts, audio cues
    ├── store.ts                 FRONT-END  app state (Zustand); runTurn() = one path for voice and typed input
    ├── wav.ts                   FRONT-END  resample + WAV encoding for Whisper
    ├── server/                  BACK-END   only imported by the API routes
    │   ├── providers.ts           Groq / Gemini / OpenAI calls, backup chain, retries, key redaction
    │   ├── prompt.ts              the system prompt
    │   └── square.ts              Square sandbox client
    ├── actions.ts               SHARED     the 12 allowed actions (Zod), the JSON schema sent to the model, validation
    ├── executor.ts              SHARED     the only place shop state changes: all arithmetic, atomic batches, rollback
    ├── context.ts               SHARED     the small per-turn snapshot sent to the model
    ├── recipes.ts, inventory.ts, shop.ts   SHARED  demo menu (30 recipes), stock catalogue, seed tickets
    ├── squareMap.ts             SHARED     Square order -> ticket mapping
    └── *.test.ts                TESTS      executor, validation/providers, Square mapping (fake data, no network)
bench/latency.test.ts            BENCHMARK  live speed + accuracy comparison of models (npm run bench)
scripts/dev.mjs                  starts whisper-server and Next together; square-seed.mjs creates sandbox test orders
```

## Setup

Requires Node 22.9 or newer (developed on Node 26) and macOS/Linux.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Put an API key in `.env.local`. **Recommended: a free Groq key plus a free Gemini key**, both without a card: Groq at https://console.groq.com/keys, Gemini at https://aistudio.google.com/apikey. Groq is used first because it was fastest in our benchmark, and Gemini takes over instantly when Groq is rate-limited or slow. One key also works. Keys are read only on the server and never reach the browser.

To re-measure speed and accuracy on 27 barista phrases (makes real API calls):

```bash
npm run bench
```

### Audio setup (local Whisper)

Transcription uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp)'s `whisper-cli` and `whisper-server`. On macOS:

```bash
brew install whisper-cpp
```

On Linux, build whisper.cpp from its repository (its README has the steps) and put `whisper-cli` and `whisper-server` on your PATH, or point `WHISPER_CLI_PATH` and `WHISPER_SERVER_PATH` at them. Only macOS was tested.

```bash
mkdir -p .models && curl -L -o .models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Use `WHISPER_CLI_PATH` / `WHISPER_MODEL_PATH` to point elsewhere. The drawer's Test tab shows whether the model was found.

## Run

```bash
npm run dev
```

`npm run dev` also starts `whisper-server` on port 8178, which keeps the speech model loaded (about 0.2 s per transcription instead of about 0.5 s). If it can't start, transcription falls back to `whisper-cli` automatically. Stopping the app stops it too.

Open http://localhost:3000 in Chrome, click **Put on earpiece and start shift**, and allow the microphone. Use headphones: echo cancellation helps, but speakers next to the mic are the most common cause of false triggers.

- **The screen at a glance**: the big word under the pearl is the voice state. Each state also has its own colour and motion, so it never depends on colour alone: *Listening* (purple glow that follows your voice), *Hearing you* / *Thinking* (amber arc spinning), *Speaking* (cream rings rippling out). The card below shows the current order, drink and recipe step.
- **Interrupt**: click the pearl or press **Space**. Speech stops, the pending turn is discarded, and listening resumes. While on shift, Space is the stop key wherever the keyboard focus is, so use **Enter** to press a focused button.
- **Audio cues**: a short rising chime means "I heard you", a soft tick every ~1 s means "still working", and a low note means something failed. The barista isn't looking at the orb, so sound is the real feedback. Turn them off in the drawer's Test tab.
- **Turn timing**: the top-right corner shows the last voice turn's time, measured from when you stopped talking.
- **Push-to-talk** (noisy rooms): enable it in the drawer's Test tab, then hold **V** or the Hold to talk button.

Checks:

```bash
npm test
```

```bash
npm run typecheck && npm run lint && npm run build
```

## Square sandbox (order import and mark-ready)

A proof of concept for connecting a real POS. It only talks to Square's **sandbox** (the host is hard-coded).

1. Create a free account at developer.squareup.com, create an application, and switch it to **Sandbox**.
2. Copy the **Sandbox access token** into `.env.local` as `SQUARE_ACCESS_TOKEN=`.
3. Create some fictional test orders (no payment is taken):

```bash
npm run square:seed
```

4. In the app: drawer → Test → **Import open orders from Square sandbox**. The demo tickets are replaced by the Square orders. Items and modifiers that don't match the menu are skipped and listed, never guessed.

Mapping lives in `src/lib/squareMap.ts`: line item names must match a recipe name, and modifiers like "Large", "50% sugar", "Less ice", "Tapioca pearls", "Oat milk" set the drink. When you complete an imported order by voice ("Ava's order is ready"), BobaJarvis sets that order's Square fulfillment to **PREPARED** (ready for pickup). The order itself stays OPEN, because fully completing it needs payment. If Square can't be reached, the local completion still stands: the reply adds "Square wasn't updated for order N" and the drawer offers Retry.

## Demo script (about 2¾ minutes)

Every line below was dry-run on 2026-11-11 and gave the described reply. While the shift is on, the app treats all speech as commands, so explain before *Start shift* and after *End shift*.

1. **Frame it (earpiece off).** A lone barista's hands and eyes are busy, so the assistant is voice-only, through an earpiece. Click *Put on earpiece and start shift*, then don't touch anything.
2. **Ticket and recipe.** "What's the first order I have to make?" (reads order 101, doesn't start it) → "Got it. What's next?" (step 1, exact ml) → "Okay, next." (exactly one step) → "Sugar?" (70%: 39 ml syrup) → "What comes after sugar?" (step 4).
3. **Completion.** "That order is done. What's the next order?" completes 101 (the AI must quote those words as evidence), deducts its ingredients once, and reads order 102 without starting it. "How do you make the second drink?" reads drink 2 and its step 1.
4. **Inventory.** "How much milk do we have?" (whole milk is now 7.65 L: order 101's 350 ml came off) → "What about oat?" → "Restock those."
5. **Interrupt and count.** "Read me order 105.", press **Space** mid-reply → "How many taro drinks are waiting?" (a drink count, not grams).
6. **Explain (earpiece off).** Drawer → Action log (the AI's action plan and quoted evidence), Inventory (exact numbers from code), and the top-right turn timing. Why local Whisper and Groq first: see the Brain benchmark in `VALIDATION.md`.

## Limitations

- Shop data is simulated and lives in browser memory. A reload resets it.
- A **live LLM provider is required** for conversation. With no key, the app shows the exact error and keeps state. There is no hidden keyword fallback, and no scripted demo mode was built.
- The browser SpeechRecognition alternative was not built. Local Whisper is the only mic path.
- VAD is a simple adaptive energy threshold, not tuned in a real shop.
- Speech synthesis voice and quality depend on the browser and OS.
- Recipes and quantities are plausible demo formulations, not a real shop's specifications.
- Accessibility was checked by keyboard and by reading the page's roles and labels, not with a real screen reader.
- Live LLM interpretation was checked on a 27-phrase benchmark (27/27 with the submitted version, single round, typed text), not on recorded speech in a noisy shop. A reworded phrase can still be misread; several such cases were found with the real microphone and fixed. See `VALIDATION.md`.
- Free-tier rate limits: at a fast pace Groq runs out of tokens per minute and the backup chain takes over, which is slower in the worst case (about 4 s).
