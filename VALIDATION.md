# Validation

First written 2026-11-09; benchmark and review pass added 2026-11-10. Machine: macOS (Apple Silicon), Node 26, Next.js 16.4.5.

## Automated checks (all run, all passing)

| Check | Result |
|---|---|
| `npm test` (Vitest) | 54 / 54 passing (the live benchmark is skipped here; run it with `npm run bench`) |
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
- Completing a different ticket ("order 103 is ready" while making 101) keeps your place in the current drink.
- Sugar scaling across percentages and sizes. Instructions and deductions come from the same numbers. Fruit teas have no powder.
- Inventory category queries, "what about oat", "restock those" with and without a referent, aliases ("fruit to us"), an unknown item that isn't invented.
- A general stock question ("what's the stock level like?") names the three lowest items and remembers them for "restock those".
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
| Brain (LLM + executor) | Gemini: median 3.4 s, p90 8.4 s (benchmark below) | Groq chain: median 0.75 s, p90 2.5 s | Smaller prompt, Groq first, instant backup chain (see Brain benchmark) |

Adding up the "after" column gives roughly 1.6 s to the start of the spoken reply at the median (0.65 + 0.22 + 0.75). That is a sum of separately measured stages, not one end-to-end measurement. The transcription numbers are from a synthesized WAV posted to `/api/transcribe`; the app now shows real per-turn timing on screen. Verified: if `whisper-server` is down, `/api/transcribe` falls back to `whisper-cli` and still returns the text, and stopping the app stops `whisper-server` (no stray process).

**Audio cues** (heard chime, thinking tick, error note) build and load without errors, but have not been separately confirmed by ear.

## Brain benchmark (live, 2026-11-10)

`npm run bench` (`bench/latency.test.ts`) sent 20 fixed barista phrases (22 since the review pass below) through the same prompt, schema and validation as `/api/jarvis`, in three shop states (fresh, mid-recipe, after an inventory question). It records time per call and whether the action types match the expected ones. All free-tier keys; one round per configuration, so treat the numbers as indicative.

**1. Baseline: the model was the problem, not our prompt.** A 3-word "Say ok" request to `gemini-3.5-flash-lite` took 7.2 s, 0.9 s, then 5.9 s: Google's free tier queues requests.

| Config (original 3,568-token prompt) | Median | p90 | Max | Correct | Notes |
|---|---|---|---|---|---|
| gemini-3.5-flash-lite (old default) | 3368 ms | 8399 ms | 11603 ms | 20/20 | 5 rate-limit retries |
| gemini-3.1-flash-lite | 1312 ms | 3994 ms | 8042 ms | 19/20 | 1 timeout |
| gemini-3.5-flash | 6685 ms | 12282 ms | | 9/20 | hit the free daily quota |
| gemini-2.5-flash-lite | | | | | retired by Google (404) |
| Groq models | | | | ≤5/20 | rate-limited: 8,000 tokens/min ≈ 2 requests/min at this prompt size |

**2. Fixes.**
- *Smaller context:* the model never states quantities, so stock levels were removed from the per-turn context, and fixed ids (items, recipes) moved into the system prompt. Context 4,015 → 1,086 characters; tokens per request 4,108 → 2,898.
- *Less hidden reasoning on Groq:* `reasoning_effort: "low"` for gpt-oss cut reasoning tokens 449 → 16 and Groq's model time 0.87 s → 0.30 s for the same request.
- *Model-output quirks handled in code, not hoped away:* a single `itemId` is accepted where `itemIds` was expected; Groq's "generated JSON does not match the schema" 400 is treated as a retryable model hiccup; and the executor now never starts a recipe in a plan that also reads or moves to a ticket (one model returned `read_ticket, read_drink, continue_recipe` for "What's the first order I have to make?").

**3. Re-measured, paced under each free-tier limit (smaller prompt).**

| Config | Median | p90 | Max | Correct |
|---|---|---|---|---|
| groq gpt-oss-20b | 710 ms | 1669 ms | 2163 ms | 18/20 (both misses since fixed in code) |
| groq gpt-oss-120b | 697 ms | 989 ms | 1184 ms | 17/20 (3 schema 400s, now retryable) |
| gemini-3.5-flash-lite | 1547 ms | 7103 ms | 10077 ms | 18/20 |
| gemini-3.1-flash-lite | 4747 ms | 17299 ms | 17653 ms | 11/20 (timeouts) |

**4. Chosen setup, at a busy barista pace (one phrase every 10 s, above Groq's free limit on purpose).** Groq rate-limits each model separately, so the chain is groq gpt-oss-20b → groq gpt-oss-120b → gemini-3.5-flash-lite. Every provider except the last gets one try and 4 s; a rate limit or outage moves to the next one immediately instead of waiting. Auth and bad-request errors are not hidden behind a backup.

| Setup | Median | p90 | Max | Correct | Errors |
|---|---|---|---|---|---|
| Gemini only, 1 key, before | 3368 ms | 8399 ms | 11603 ms | 20/20 | 0 |
| Groq 20b + Gemini backup | 1467 ms | 4025 ms | 7907 ms | 19/20 | 0 (backup used 9×) |
| **Groq 20b → Groq 120b → Gemini (shipped)** | **748 ms** | **2520 ms** | **4132 ms** | **20/20** | **0** (backup used 9×) |

In the app (typed test box, same path as the mic), "What's the first order I have to make?" then "Got it. What's next?" answered via groq/gpt-oss-20b in 948 ms end to end, read the ticket without starting it, then started step 1.

Not measured: more than one round per configuration, paid tiers, or how the chain behaves when Groq is fully down for minutes (unit tests cover the switch with a fake fetch).

## Review pass (2026-11-10, evening)

A code review and front-end polish, done with an AI assistant (see `ai.md`). One commit per change in the git log.

**A misread the benchmark had missed.** While testing the new screen, "Got it. What's next?" said right after a ticket was read aloud moved to the *next order* instead of starting the recipe: wrong in 4 of 5 live tries (the model returned `next_drink` or `read_ticket next`), including the reworded "What is next?". The benchmark had only tried that phrase on a fresh state with no earlier turns, which is not the order of the demo. Nothing was completed or deducted by the misread, but the barista would lose their place.

- *Fix:* one rule added to the system prompt: a bare "what's next" with no "order", "ticket" or "drink" always means the next recipe step.
- *Benchmark:* two cases added for exactly this situation (22 phrases now).
- *Re-checked in the app (typed test box, live):* 5 of 5 correct, including "What's the next order?" still reading the next ticket.
- *Benchmark re-run on the shipped chain:* **22/22 correct, 0 errors.**

| Setup (prompt with the "next" rule) | Median | p90 | Max | Correct | Errors |
|---|---|---|---|---|---|
| Groq 20b → Groq 120b → Gemini | 962 ms | 5360 ms | 10048 ms | 22/22 | 0 (backup used 22×) |

**Read the speed in this row with care.** The backup was used on every phrase, because the manual test calls made minutes earlier had already used up Groq 20b's free per-minute allowance. So this run shows the chain's worst case, not its normal speed, and it was not repeated (to save the free daily quota). The speed figures in the Brain benchmark section were measured before the prompt rule was added (it adds about 70 tokens to a roughly 2,900-token request).

**Front-end, checked in a browser with a simulated microphone.** The browser used for the check blocks microphone access, so a silent fake microphone and a canned transcript were injected to drive the real voice loop through Listening, Hearing you, Thinking and Speaking. Checked this way: each state's word, colour and motion; the current-drink card and step bar updating; a 375 px wide phone layout with no sideways scroll; the drawer's tabs by arrow keys; Space interrupting while on shift even with a button focused, and pressing buttons normally when off shift; the microphone-denied message. Before and after screenshots were taken but are not in the repo.

**A mishearing found with the real microphone (2026-11-10).** "How do you make the second drink, step by step?" was transcribed as "the second ring", and the app only read the drink out instead of also starting step 1. Asked through the API, the model returns `read_drink` plus `read_stage 1` for "drink" but only `read_drink` for "ring", so the transcription was the cause. "Drink" phrases were added to Whisper's vocabulary hint. Checked with three synthesized voices (macOS `say`): one of them was misheard before ("second dream") and none after. The author then repeated the sentence with the real microphone and reported that it worked (one try).

**Three more misreads from the author's microphone session (2026-11-10, from the action log).**

| Said | What happened | Fix |
|---|---|---|
| "How do you make the second drink?" | Only read the drink out; no recipe step. | Prompt rule: "how do I make…" means the recipe from step 1 (`read_drink` then `read_stage 1` for another drink). |
| "What's the stock level like?" / "Check all the stock." | Asked back "Which item or category?" | The app now answers a general stock question itself: the three lowest items, and that everything else is above a stated percentage. Prompt tells the model not to ask which category. |
| "Check for all of them." (answering that question) | Counted the ticket queue instead. | No direct fix: the question that caused it is gone. |

Checked live after the change, one call each through `/api/jarvis` with hand-built contexts: the three phrases above, plus seven existing ones to catch regressions ("What's the second drink?", "How do I make this?", "Restock those.", "How much milk do we have?", "Got it. What's next?", "That order is done. What's the next order?", "Sugar?"). 10 of 10 returned the expected actions. Groq 20b answered none of them (its free allowance was used up at the time); Groq 120b and Gemini answered, so this is not evidence about 20b with the new rules.

Four cases were added to the benchmark (26 phrases now), but **the full benchmark has not been re-run since these two prompt rules were added**, to save the free daily quota. The 22/22 result above is for the prompt before them.

**Demo dry run (2026-11-11).** The 12-line video script was typed through the Test box (same path as the mic). One bug found: "What comes after sugar?" jumped to step 5. Both Groq models put the *answer* (stage 4) in `stage`, and the app then added "after". The benchmark had passed it because it only compared action types. Fix: the schema and prompt say `stage` is the stage the barista *named*; the benchmark now checks stage number and relation too. Re-asked 9 times across both models after the fix ("after sugar" ×3 per model, "step five", "before the ice"): all correct. The full script then ran 12/12 as expected.

**Recording session (2026-11-12): slow turns.** While recording, some replies took several seconds. Groq still had its daily quota, but its free tier allows 8,000 tokens per minute per model (about 2 requests at ~3,000 tokens), so quick back-to-back commands fell through to Gemini, which that day took 5.6-9.7 s and once returned 503 "high demand". Two cuts to what every request carries: item ids and their mishearing aliases are listed once instead of twice (system prompt 7,885 -> 7,343 characters), and the context sends the last 3 exchanges with long replies shortened, instead of the last 5 in full (which grew by several hundred tokens per request as a demo went on). Then the 10-command demo script was simulated through the real chain and executor, one command every ~10 s: 10/10 correct, all answered by groq gpt-oss-20b in 359-1405 ms, context 1,118-1,737 characters. Not measured: the same simulation before the change, so the improvement is not quantified. A reported "Sugar?" -> step 2 could not be reproduced: Whisper transcribed "Sugar" correctly in 5 synthetic voices, and all three models returned `order_attribute: sugar` for "Sugar?", "Sugar.", "Sugar" and "And sugar?" right after step 1.

**Recording session (2026-11-12): "How much oat milk do we have?"** read out every milk. Both Groq models returned `category: milk` for it 3 times out of 3 (the prompt's only example was the general "how much milk"). The prompt now says a specific item goes in `itemIds` and only a general word uses `category`. Re-asked on gpt-oss-20b: "how much oat milk do we have / is left" and "how much taro powder" -> that item only, "how much milk" -> all milks, 4/4. gpt-oss-120b was rate-limited during the re-test, so it is unchecked. The benchmark checks action types, not item ids, so it would not catch this case.

## Checked by hand only

- **Real microphone (2026-11-10, before the front-end polish):** the author ran the voice checklist in Chrome with headphones (ticket, recipe steps, completion, inventory, interrupt) and reported it smooth; server logs from those turns showed Whisper at about 0.2 s and Groq at about 1.0 s. VAD thresholds are not tuned for a noisy shop.
- **Audible playback** through speech synthesis: confirmed by the author during the voice test (units are now spoken as words, e.g. "1.4 litres").

## Not verified

- **Real microphone on the polished screen:** not re-tested yet. The voice loop code changed only in small ways (see the git log), but the screen around it is new.
- **Screen reader:** roles, labels and live regions were checked in the browser's accessibility tree, not with VoiceOver or another real screen reader. Colour contrast was calculated by hand (WCAG formula), not with an audit tool.
- **Live LLM interpretation:** checked on the benchmark phrases above (single rounds), not on a larger or noisier set. A small rewording can still be misread (see the review pass).
- **OpenAI path:** the request code exists and shares the Groq format, but no OpenAI key was ever used, so it has never been called live.
- **Square failure path** (Square down or rejecting): not exercised live.
- **Noisy-shop performance** (blenders, sealing machine, music): untested.
