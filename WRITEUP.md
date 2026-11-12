# BobaJarvis: voice for the hands-busy barista

*A voice AI prototype for workplace productivity.*

## The problem and who it's for

Many small bubble tea shops run single-staffed shifts. One person reads tickets, builds drinks and notices when oat milk runs out, but the POS assumes someone can look at a screen and tap it. A lone barista can't: both hands are on a shaker, eyes on the cup, gloves sticky. Every glance breaks rhythm, and every forgotten modifier ("less ice", "oat milk") is a remake the shop pays for.

## The idea

Hands and eyes are busy; ears and voice are free. BobaJarvis is an earpiece assistant: after "start shift" the barista hears any ticket with every modifier, steps through a recipe one measured instruction at a time ("Sugar?" -> "70%: 39 ml brown sugar syrup"), completes orders by voice, and checks or restocks stock with follow-ups like "what about oat?" and "restock those". The screen is only for a glance: the voice state, the current drink and the last reply.

## The key design decision

**The LLM decides what was meant; my code does what happens.** The model turns each sentence into a plan built from 12 allowed actions, constrained by a JSON schema and validated with Zod. A deterministic executor applies it: all arithmetic, every stock change, atomically, with rollback if any step fails. So the model can't invent quantities or tickets. Completing an order is the one irreversible action, so the model must quote the barista's exact words as evidence; a misheard "got it" can never complete an order. Shop data is simulated, but as a proof of concept the app also imports open orders from Square's sandbox and marks them ready for pickup.

## Speed: measured, not guessed

An answer has to arrive mid-pour, so I built a benchmark (`npm run bench`) that runs fixed barista phrases through the real prompt and validation, timing each model.
- **Transcription** runs locally on a warm `whisper-server`: about 0.2 s, and audio never leaves the shop.
- **The LLM was the bottleneck.** Gemini's free tier took a median 3.4 s, 1 in 10 over 8 s. I cut the prompt by about 30% (the model never needs stock quantities), moved to Groq with low reasoning effort, and added a fallback chain (Groq 20b, Groq 120b, Gemini) that switches instantly on rate limits but never hides an auth error.
- **Result** on the final 27-phrase run: 27/27 correct, median 0.69 s for the LLM step; roughly 1.5-2 s from the end of speech to the start of the reply.

## What testing taught me

Unit tests (54) prove the executor; they can't prove understanding. An early benchmark scored 20/20, yet using the app with a real microphone exposed failures it didn't contain: "drink" heard as "ring", "What comes after sugar?" skipping a step, "How much oat milk?" reading every milk. Each became a fix and a new benchmark case (27 now, all passing). A benchmark only proves the cases it contains, so real use has to keep feeding it.

## Next steps

1. Test with real earpieces and real shop noise, and grow the benchmark from recorded speech.
2. Replace the Square sandbox with a live POS: new orders by webhook, synced inventory.
3. Keep shift state on a server, so a reload or second device doesn't lose it.
