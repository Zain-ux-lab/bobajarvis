# BobaJarvis: voice for the hands-busy barista

*A voice AI prototype for workplace productivity.*

## The problem

Many small bubble tea shops run single-staffed shifts, especially at opening, closing and off-peak. One person takes orders, reads tickets, builds drinks, and notices when oat milk runs out. The POS and kitchen display assume someone can look at a screen and tap it. A lone barista usually can't: both hands are on a shaker or a sealing machine, and their eyes are on the line they are pouring to. Every glance at a ticket breaks rhythm. Every tap with wet or sugary gloves is slow and unhygienic. Every forgotten modifier ("less ice", "oat milk") is a remake. That is a B2B productivity problem: the shop pays for it in throughput, waste and customer complaints, and it is worst when there is no second person to help.

## Who it is for

The lone worker at an independent or small-chain shop, not the owner at a dashboard. They know the menu but not every formulation by heart, especially new hires and seasonal drinks. They need answers in a few seconds, in a sentence, without stopping.

## Why voice, and why an earpiece

Hands and eyes are already busy, but ears and voice are free. An earpiece keeps replies private and audible over shop noise. "Read the ticket", "sugar?", "what's next?" are naturally short spoken questions. A screen only adds value for setup and for checking the system.

Noise shapes the design. Blenders, shakers, the sealing machine and music mean:
- Transcription must be robust. It runs locally (whisper.cpp) with a vocabulary prompt, so customer audio never leaves the shop and doesn't depend on internet quality.
- Mishearings are expected ("tarah" for taro). The LLM interprets them in context, backed by a small alias dictionary.
- There is a push-to-talk mode for the loudest moments, and Space or a tap on the orb interrupts.
- Mutating actions are conservative. A misheard "got it" must never complete an order, so completion requires an explicit, quoted phrase.

## What the prototype does

After "Start shift" the barista can hear any ticket with every modifier, step through a seven-stage recipe one measured instruction at a time, ask short attribute questions about the current drink, complete a ticket by voice (ingredients are deducted once, and the next ticket is read but not started), and query or restock inventory with follow-ups like "what about oat?" and "restock those". Low stock gets one short warning appended to the reply.

The key design choice is the split of responsibilities. The LLM only interprets language into a small, validated action vocabulary. Application code owns every state transition, measurement and inventory number, and runs each batch atomically. This makes the factual parts testable and stops the model from inventing quantities or tickets. All POS and inventory data is simulated. As a proof of concept for a real POS, it can also import open orders from Square's sandbox and mark an order ready for pickup when the barista says it's done.

## The screen: built for a glance

The barista should not need the screen, but when they do look up it has to answer three questions in under a second, in this order.
- **Is it listening to me?** The voice state is the largest thing on screen. Each state has its own word, colour and motion (a glow that follows the voice, a spinning arc, rippling rings), so it still reads for someone who can't tell the colours apart or has animations turned off.
- **Where am I?** One card shows the order, the drink and a seven-step progress bar. It sits above the reply so a long answer can never push it off screen.
- **What did it say?** The last reply, in large type, for when a word was missed in the noise.

Everything a reviewer needs (tickets, stock, action log, test tools) lives in a drawer labelled as simulated, out of the barista's way. Space is one big stop key while on shift. The page works by keyboard, labels itself for screen readers, and fits a phone.

## Speed: choices backed by measurement

A spoken answer has to arrive while the barista is still mid-pour, so I measured instead of guessing (`npm run bench`, 20 fixed barista phrases; details in `VALIDATION.md`).
- **Transcription:** local `whisper-server` keeps the model loaded: about 0.2 s, versus 0.4-0.6 s when reloading each time. Audio stays on the machine.
- **End of speech:** 650 ms of silence ends a sentence (down from 900 ms), short enough to feel snappy, long enough not to cut people off.
- **The LLM was the bottleneck.** Gemini's free tier queued requests: median 3.4 s, 1 in 10 over 8 s. I cut the prompt by 30% (the model never needs stock quantities, since code states every number), switched to Groq (median 0.7 s), and lowered its hidden reasoning (model time 0.87 s to 0.30 s).
- **Free-tier limits handled by design:** Groq allows about 2 requests a minute per model, so the server tries Groq 20b, then Groq 120b, then Gemini, switching instantly on a rate limit. Result at a busy pace: median 0.75 s, 1 in 10 over 2.5 s, 20/20 correct.

A lesson from the final review: the benchmark scored 20/20, yet "Got it. What's next?" said right after a ticket readout was sent to the next order 4 times out of 5, because the benchmark had only tried it on a fresh state. I added that exact situation to the benchmark and one rule to the prompt; it now scores 22/22. A benchmark only proves the cases it contains.

## Next steps

1. Grow the benchmark into recorded barista speech with real shop noise, run several rounds, and track accuracy per phrase type.
2. Field-test speech detection and push-to-talk with real earpieces in a working shop. Consider a wake word.
3. Move from the Square sandbox to a live POS: receive new orders by webhook instead of a manual import, and sync inventory.
4. Add a server-side state store so a reload or a second device doesn't lose the shift.
5. Proactive cues: new-ticket announcements and tapioca batch age reminders.
