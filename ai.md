# AI assistance disclosure

This prototype was written with heavy help from an AI coding assistant (Claude, in Claude Code). The assistant wrote most of the code, tests and documents from a detailed specification. It also checked provider documentation for current model names and request formats, ran the tests, type-checker and build, and tested local transcription with synthesized audio.

Tools used: Claude Code as the coding assistant (Claude Opus for the build, Claude Fable 5.2 for a final code review and front-end polish on 2026-11-10); Groq (gpt-oss-20b, gpt-oss-120b) and Google Gemini (gemini-3.5-flash-lite) as the app's runtime LLMs; whisper.cpp (`ggml-base.en`) for local speech-to-text; the browser's built-in speech synthesis for the voice.

The AI also wrote and ran the live benchmark (`npm run bench`) that compared models on 20 barista phrases (22 after the review) and led to the switch from Gemini to Groq with a backup chain, and ran live checks against the Square sandbox. I tested the real microphone and voice playback myself in Chrome. Not done: an evaluation on recorded speech or in a noisy shop. See `VALIDATION.md`.

In the final review pass the AI listed findings, fixed the ones that mattered (see the git history, one commit per change), re-ran the benchmark, and checked the new screen in a browser with a simulated microphone. It could not use a real microphone, so the voice loop on the new screen still has to be re-tested by me (see `VALIDATION.md`).

## What the student must understand to own this code

You should be able to explain and change each of these without the AI:

1. **The split between language and state.** Why `/api/jarvis` returns only an action plan, and why `executePlan()` in `src/lib/executor.ts` is the only place state changes. Be able to add a new action type end to end: Zod schema, flat JSON schema, prompt line, executor case, test.
2. **Validation layers.** The provider JSON schema constrains output. Zod (`normalizePlan`) validates it at runtime. The executor re-checks against real state (does the order exist, is the drink index valid, is the unit compatible). Know why each layer exists.
3. **Completion safety.** Why `completionEvidence` must be a quote from the transcript, what that check proves (grounding) and what it doesn't (meaning), and how the prompt separates "got it" from "order 104 is ready".
4. **Atomicity and idempotency.** `structuredClone` plus rollback on `ActionError`, the `deducted` flag, and ticket `credits` for manual usage.
5. **The single ingredient function.** `drinkLines()` feeds both spoken steps and deductions, so they can't disagree. Know how size and sugar scaling round.
6. **The voice state machine** in `src/lib/earpiece.ts`: the `generation` counter that drops stale results, the feedback gate (audio is ignored unless Listening), pre-roll, the 650 ms silence boundary, and the 400 ms resume delay.
7. **Stale turns** in `src/lib/store.ts`: turn id and state version, and AbortController cancellation.
8. **Provider handling**: why Groq is tried first and how the backup chain (`callWithBackup`) switches on rate limits but not on auth errors, bounded retries, honouring `retry-after`, never retrying daily quota, the server deadline being shorter than the client timeout, and secret redaction.
9. **The screen.** Why the voice state is shown three ways (word, colour, motion), why the current-drink card sits above the reply, why Space is only the stop key while on shift, and why the reply is hidden from screen readers while the earpiece is already speaking it (`src/app/page.tsx`, `.voice` in `globals.css`).
10. **What the tests prove and what they don't.** Mocked plans test the executor, not language understanding.
