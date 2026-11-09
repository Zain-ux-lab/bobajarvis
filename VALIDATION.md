# Validation

Date: 2026-11-09. Machine: macOS (Apple Silicon), Node 26, Next.js 16.4.5.

## Automated checks (all run, all passing)

| Check | Result |
|---|---|
| `npm test` (Vitest) | 39 / 39 passing |
| `npm run typecheck` (strict) | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds (one harmless warning: no fallback-metrics for the Atkinson Hyperlegible Next font) |

### What the unit tests prove (with hand-written action plans)

- Recipe continuation from "not started" (goes to step 1) and from a middle step (moves exactly one step).
- Final step: a one-drink ticket asks "ready to hand over?" and never completes. A multi-drink ticket moves to the next drink without starting it.
- "What comes after sugar" (`read_stage` 3 / after) selects step 4.
- Ticket reads never start or advance a recipe, and asking for the next order doesn't complete the current one.
- Full modifiers (size, sugar, ice, toppings, milk substitution) on single- and multi-drink readouts.
- Next-drink behaviour within and across tickets. Invalid drink index is rejected.
- Completion: exact deductions, oldest pending ticket selected, recipe not started. A retried completion doesn't deduct twice. "Complete + read next" in one plan doesn't skip a ticket. Repeated completions in one utterance complete only one ticket. Evidence must be quoted from the transcript.
- Manual usage logged against a ticket is credited at completion (no double count).
- Sugar scaling across percentages and sizes. Instructions and deductions come from the same numbers. Fruit teas have no powder.
- Inventory category queries, "what about oat", "restock those" with and without a referent, aliases ("fruit to us"), an unknown item that isn't invented.
- Low-stock warning appended once, only when crossing below 15%, after the main reply.
- Atomic rollback when one action in a batch fails. Unit and over-use rejections.
- Plan validation rejects unknown types, negative amounts, a zero drink index, ungrounded or duplicate completions.
- Provider handling with a **fake fetch**: no provider chosen without a key, key redaction, no retry on daily quota, bounded retry on 503, auth errors not retried.
- Stale-response predicate (turn id and state version) and the WAV header.

**These tests do not prove natural-language understanding.** They feed actions written by hand. Whether a real model maps "got it, what's next?" to `continue_recipe` is a separate question (see below).

## Manual / integration checks actually performed

- **Local Whisper**: `whisper-cli` (Homebrew whisper.cpp) with `ggml-base.en`. Phrases synthesized with macOS `say` and posted as 16 kHz WAV to `/api/transcribe` were transcribed exactly, e.g. "Order 104 is ready. How much fructose do we have?" (~0.9 s round trip). Temp files were confirmed removed. A non-WAV / too-short body is rejected with a 400.
- **Preview**: `npm run dev`. The page loads at http://localhost:3000. The drawer opens, and the Test tab reports the Whisper model found.
- **No-provider path**: with no key configured, a typed phrase shows `Brain error: No LLM provider configured…`, the brain badge shows "No LLM configured", and shop state is unchanged.

## Live semantic check (real Gemini call, 2026-11-09)

Provider `gemini`, model `gemini-3.5-flash-lite`, via the typed test box (same path as the mic: `/api/jarvis`, then the executor), on the fictional seed data. 3 API calls in total.

| Utterance | State before | Model actions | App result | Latency |
|---|---|---|---|---|
| "Got it. What's next?" | Order 101, not started | `continue_recipe` | Step 1 of 7: large 700 ml cup, 350 ml whole milk | 1399 ms |
| "Got it. What's next?" | Order 101, step 1 | `continue_recipe` | Step 2 of 7: 140 ml brewed black tea (exactly one step) | 1355 ms |
| "That order is done. What's the next order?" | Order 101, step 2 | `complete_ticket` with evidence "That order is done." | 101 completed, full readout of 102 (both drinks, all modifiers), 102 not started | 1061 ms |

All three matched the required semantics. The model did not add a redundant `read_ticket` after the completion. This is a sample of three phrases, not a measure of accuracy.

## Square sandbox import (live, 2026-11-09)

Against the user's own Square **sandbox** ("Default Test Account"), Square-Version `2026-09-16`.

- `npm run square:seed` created 3 fictional OPEN orders (811 Ava, 812 Ben, 813 Chloe) with free-form line items, free-form $0 modifiers and an ASAP pickup recipient. Square accepted all three.
- `GET /api/square` (SearchOrders, OPEN, last 24 h) returned all 3 immediately. The September sandbox search bug reported on Square's forum did not occur.
- Mapping was exact: 811 Large Taro Milk Tea 50% / less ice / tapioca; 812 Regular Matcha Latte 70% / regular ice / oat milk plus Large Mango Green Tea 100% / no ice / popping boba and aloe; 813 Regular Thai Milk Tea 0% / less ice / pudding. The off-menu "Dragonfruit Slush" was skipped with a visible warning.
- In the app, Import replaced the demo tickets. "What's the current order?" through live Gemini answered "Order 811 for Ava: Large Taro Milk Tea, 50% sugar, less ice, with tapioca pearls." (1194 ms).
- Importing again added 0 new tickets (no duplicates).

**Mark ready in Square (live):** after import, typing "Ava's order is ready. What's next?" made live Gemini return `complete_ticket`. BobaJarvis completed 811 and read 812, then called `/api/square/ready`. Reading the order straight from Square afterwards showed its fulfillment moved PROPOSED → RESERVED → PREPARED (version 1 → 3), with the order still OPEN. Calling the route again changed nothing, and a malformed order ID got a 400. The drawer showed "marked ready for pickup in Square".

Not tested live: the failure path (Square down or rejecting), which appends "Square wasn't updated for order N." to the reply and shows a Retry button. Not done: webhooks or automatic polling (import is manual), and fully COMPLETING orders in Square (that needs payment).

## Response time (2026-11-09)

Measured per stage, from when the barista stops talking:

| Stage | Before | After | How |
|---|---|---|---|
| End-of-speech wait | 900 ms | 650 ms | Shorter silence boundary |
| Transcription | 400–600 ms (`whisper-cli` reloads the model each time) | ~220 ms (3 runs: 230, 210, 220) | `whisper-server` keeps the model loaded |
| Brain (Gemini + executor) | ~1.1–1.4 s | unchanged | `gemini-3.5-flash-lite` used no thinking tokens, so a lower thinking setting gave no gain |

Roughly 2.4–2.9 s → 2.0–2.3 s to the start of the spoken reply. The transcription numbers are from a synthesized WAV posted to `/api/transcribe`; the app now shows real per-turn timing on screen. Verified: if `whisper-server` is down, `/api/transcribe` falls back to `whisper-cli` and still returns the text, and stopping the app stops `whisper-server` (no stray process).

**Audio cues** (heard chime, thinking tick, error note) build and load without errors, but have **not been heard by ear** in this session.

## Not verified

- **Live LLM interpretation: only the three phrases below were checked.** A broader evaluation set has not been run.
- Gemini's handling of the nullable-enum schema was exercised only by these three calls.
- **Real microphone capture, VAD thresholds, pre-roll and interrupt timing**: not exercised with a physical mic in this session. Only synthesized audio sent straight to the endpoint was tested.
- **Audible playback** through speech synthesis: not confirmed by ear.
- **Noisy-shop performance** (blenders, sealing machine, music): untested.
