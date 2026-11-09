# AI assistance disclosure

This prototype was written with heavy help from an AI coding assistant (Claude, in Claude Code). The assistant wrote most of the code, tests and documents from a detailed specification. It also checked provider documentation for current model names and request formats, ran the tests, type-checker and build, and tested local transcription with synthesized audio.

The AI also ran a three-phrase live check against Gemini (all passed). What the AI did **not** do: it did not run a broad language-understanding evaluation, and it did not test a real microphone, audible playback or a noisy shop. See `VALIDATION.md`.

## What the student must understand to own this code

You should be able to explain and change each of these without the AI:

1. **The split between language and state.** Why `/api/jarvis` returns only an action plan, and why `executePlan()` in `src/lib/executor.ts` is the only place state changes. Be able to add a new action type end to end: Zod schema, flat JSON schema, prompt line, executor case, test.
2. **Validation layers.** The provider JSON schema constrains output. Zod (`normalizePlan`) validates it at runtime. The executor re-checks against real state (does the order exist, is the drink index valid, is the unit compatible). Know why each layer exists.
3. **Completion safety.** Why `completionEvidence` must be a quote from the transcript, what that check proves (grounding) and what it doesn't (meaning), and how the prompt separates "got it" from "order 104 is ready".
4. **Atomicity and idempotency.** `structuredClone` plus rollback on `ActionError`, the `deducted` flag, and ticket `credits` for manual usage.
5. **The single ingredient function.** `drinkLines()` feeds both spoken steps and deductions, so they can't disagree. Know how size and sugar scaling round.
6. **The voice state machine** in `src/lib/earpiece.ts`: the `generation` counter that drops stale results, the feedback gate (audio is ignored unless Listening), pre-roll, the 900 ms silence boundary, and the 400 ms resume delay.
7. **Stale turns** in `src/lib/store.ts`: turn id and state version, and AbortController cancellation.
8. **Provider handling**: bounded retries, honouring `retry-after`, never retrying daily quota, the server deadline being shorter than the client timeout, and secret redaction.
9. **What the tests prove and what they don't.** Mocked plans test the executor, not language understanding.
