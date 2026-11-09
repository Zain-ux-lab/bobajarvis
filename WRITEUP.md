# BobaJarvis: voice for the hands-busy barista

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

The key design choice is the split of responsibilities. The LLM only interprets language into a small, validated action vocabulary. Application code owns every state transition, measurement and inventory number, and runs each batch atomically. This makes the factual parts testable and stops the model from inventing quantities or tickets. All POS and inventory data is simulated.

## Next steps

1. Run the live semantic check and a small evaluation set of real recorded barista phrases (with noise) to measure interpretation accuracy.
2. Field-test VAD thresholds and push-to-talk with real earpieces in a working shop. Consider a wake word.
3. Connect to a real POS order feed and inventory source, read-only first.
4. Add a server-side state store so a reload or a second device doesn't lose the shift.
5. Proactive cues: new-ticket announcements and tapioca batch age reminders.
