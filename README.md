# BobaJarvis

An earpiece-first voice assistant prototype for a bubble tea shop worker who is working alone. The worker starts a shift once. After that they hear tickets, ask follow-up questions, get measured recipe steps one at a time, complete orders and manage stock by voice, without touching or looking at the screen.

> **Honesty label:** the POS tickets, recipes and inventory are **simulated demo data** held in the browser. Nothing connects to a real shop system.

## How it works (one paragraph)

Speech → local Whisper (`/api/transcribe`) → transcript → `/api/jarvis` (LLM turns language into a **validated JSON action plan**) → `executePlan()` (app code changes state, does all arithmetic, writes the factual reply) → browser speech synthesis. Typed test phrases use the same path, starting at `/api/jarvis`. The LLM never edits state and never states quantities. It only picks actions such as `continue_recipe` or `complete_ticket`.

| File | Role |
|---|---|
| `src/lib/recipes.ts` | 30 demo recipes and `drinkLines()`, the single ingredient calculation used for both instructions and deductions |
| `src/lib/inventory.ts` | Stock catalogue, units, capacities, mishearing aliases |
| `src/lib/actions.ts` | Action vocabulary (Zod discriminated union), the flat provider JSON schema, validation, completion-evidence check |
| `src/lib/executor.ts` | All state transitions; atomic batches with rollback; low-stock warnings |
| `src/lib/store.ts` | Zustand store; `runTurn()` (one path for voice and typing); stale-response guard |
| `src/lib/earpiece.ts` | Voice state machine, VAD with pre-roll, feedback gating, interrupts |
| `src/lib/server/providers.ts` | Gemini / Groq / OpenAI REST calls, bounded retries, redaction |
| `src/app/api/jarvis`, `src/app/api/transcribe` | Server endpoints |

## Setup

Requires Node 20+ and macOS/Linux.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Put **one** API key in `.env.local` (Gemini is the default). Keys are read only on the server and never reach the browser.

### Audio setup (local Whisper)

Transcription uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp)'s `whisper-cli`.

```bash
brew install whisper-cpp
```

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

- **Interrupt**: click the pearl or press **Space**. Speech stops, the pending turn is discarded, and listening resumes.
- **Audio cues**: a short rising chime means "I heard you", a soft tick every ~1 s means "still working", and a low note means something failed. The barista isn't looking at the orb, so sound is the real feedback. Turn them off in the drawer's Test tab.
- **Turn timing**: the top-right corner shows the last voice turn's time, measured from when you stopped talking.
- **Push-to-talk** (noisy rooms): enable it in the drawer's Test tab, then hold **V** or the Hold to talk button.

Checks:

```bash
npm test
```

```bash
npm run typecheck && npm run build
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

## Demo script (about 2½ minutes)

1. **(0:00) Frame it.** "A lone barista has both hands on a shaker and eyes on the cup. Every screen tap costs time and hygiene." Click *Put on earpiece and start shift*. From here on, don't touch anything.
2. **(0:15) Ticket.** Say *"What's the first order I have to make?"* You hear order 101 with size, sugar, ice and toppings.
3. **(0:30) Recipe.** *"Got it. What's next?"* starts step 1 with exact millilitres. Say it again: it moves exactly one step. Ask *"Sugar?"* to hear the percentage and the exact syrup amount. Ask *"What comes after sugar?"* to hear step 4.
4. **(1:00) Not-a-completion.** Say *"Got it."* Point out that nothing completed and no stock moved. Open the drawer briefly to show this.
5. **(1:15) Completion.** *"That order is done. What's the next order?"* completes 101, deducts its ingredients once, and reads order 102 (two drinks) without starting it.
6. **(1:40) Inventory.** *"How much milk do we have?"* then *"What about oat?"* then *"Restock those."* Show the inventory values flash in the drawer.
7. **(2:05) Counting.** *"How many taro drinks are waiting?"* gives a drink count, not grams.
8. **(2:15) Interrupt.** Ask for a long ticket, press Space mid-sentence, and ask something else.
9. **(2:30) Close.** Point at the brain badge (real provider/model and latency) and the honesty label on the drawer.

## Limitations

- Shop data is simulated and lives in browser memory. A reload resets it.
- A **live LLM provider is required** for conversation. With no key, the app shows the exact error and keeps state. There is no hidden keyword fallback, and no scripted demo mode was built.
- The browser SpeechRecognition alternative was not built. Local Whisper is the only mic path.
- VAD is a simple adaptive energy threshold, not tuned in a real shop.
- Speech synthesis voice and quality depend on the browser and OS.
- Recipes and quantities are plausible demo formulations, not a real shop's specifications.

- Live LLM interpretation was checked on only three phrases (all passed). See `VALIDATION.md`.
