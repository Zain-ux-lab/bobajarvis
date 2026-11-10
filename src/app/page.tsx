"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Earpiece, type TurnTiming, type VoiceState } from "@/lib/earpiece";
import { RECIPE_BY_ID, STAGES } from "@/lib/recipes";
import { useShop, type Brain } from "@/lib/store";

// The big word under the pearl. Colour and motion for each state live in globals.css (.voice).
const STATE_WORD: Record<VoiceState, string> = {
  idle: "Earpiece off",
  listening: "Listening",
  transcribing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
};

const BUTTON = "border-edge min-h-11 rounded-full border px-5 text-sm";

export default function Home() {
  const { shop, brain, lastUtterance, lastReply, runTurn, setBrain } = useShop();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState("");
  const orb = useRef<HTMLButtonElement>(null);

  // One Earpiece for the life of the page. It is a plain class, not React state,
  // so it calls onChange (rerender) whenever its voice state changes.
  const [ear] = useState(() => new Earpiece({
    onTranscript: (text) => {
      setError("");
      return useShop.getState().runTurn(text); // same path as the typed test box
    },
    onCancel: () => useShop.getState().cancelTurn(),
    onChange: rerender,
    onError: setError,
  }));

  useEffect(() => {
    // The glow follows the microphone only while listening. While speaking the mic is ignored, so CSS animates instead.
    let raf = 0;
    const tick = () => {
      orb.current?.style.setProperty("--lvl", String(ear.state === "listening" ? ear.level : 0));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ear.stop(); // reliable cleanup on unmount / hot reload
    };
  }, [ear]);

  useEffect(() => {
    fetch("/api/jarvis").then((r) => r.json()).then((s) => setBrain({ configured: s.configured, provider: s.provider, model: s.model })).catch(() => setBrain({ configured: false }));
  }, [setBrain]);

  // On shift, Space is the stop key wherever the focus is (buttons still work with Enter),
  // and V is push-to-talk when that mode is on. Off shift, keys behave normally.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
    const down = (k: KeyboardEvent) => {
      if (ear.state === "idle" || typing(k.target)) return;
      if (k.code === "Space") {
        k.preventDefault();
        ear.interrupt();
      } else if (k.code === "KeyV" && !k.repeat) ear.setPttHeld(true);
    };
    const up = (k: KeyboardEvent) => {
      if (k.code === "KeyV" && !typing(k.target)) ear.setPttHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ear]);

  const state = ear.state;
  const on = state !== "idle";
  const busy = state === "transcribing" || state === "thinking";

  const startShift = () => {
    setError("");
    void ear.start();
  };

  const typed = async (text: string) => {
    setError("");
    const reply = await runTurn(text);
    if (reply && ear.state !== "idle") ear.say(reply);
  };

  const ticket = shop.tickets.find((x) => x.id === shop.activeOrderId);
  const drink = ticket?.drinks[shop.activeDrinkIndex];
  const step = shop.currentRecipeStepIndex; // -1 = not started

  let hint = "";
  if (state === "listening" && ear.pushToTalk) hint = "Hold V to talk";
  else if (busy || state === "speaking") hint = "Press Space to interrupt";

  return (
    <main className="flex min-h-dvh flex-col items-center gap-5 px-4 pb-24 pt-4">
      <header className="flex w-full max-w-5xl items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold tracking-tight">BobaJarvis</h1>
          <p className="text-husk text-xs">Prototype with simulated shop data</p>
        </div>
        <BrainBadge brain={brain} timing={ear.lastTiming} />
      </header>

      {/* 1. Voice state: the first thing a glance should catch. */}
      <section data-state={state} className="voice flex flex-col items-center gap-3 pt-2" aria-label="Voice state">
        <button ref={orb} type="button" onClick={() => (on ? ear.interrupt() : startShift())} aria-label={on ? "Interrupt and listen again" : "Start shift"} className="orb">
          <span aria-hidden className="orb-halo" />
          {busy && <span aria-hidden className="orb-spinner" />}
          {state === "speaking" && (
            <>
              <span aria-hidden className="orb-ripple" />
              <span aria-hidden className="orb-ripple" />
            </>
          )}
          <span aria-hidden className="orb-pearl" />
        </button>
        <p role="status" className="font-display text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: "var(--halo)" }}>
          {STATE_WORD[state]}
        </p>
        <p className="text-husk h-5 text-sm">{hint}</p>
      </section>

      {/* 2. Where the barista is: order, drink, recipe step. */}
      <section className="border-leaf bg-steep w-full max-w-xl rounded-2xl border px-4 py-3" aria-label="Current drink">
        {ticket && drink ? (
          <>
            <p className="text-husk text-sm">
              Order {ticket.id} for {ticket.customer}
              {ticket.drinks.length > 1 && `, drink ${shop.activeDrinkIndex + 1} of ${ticket.drinks.length}`}
            </p>
            <p className="font-display text-lg leading-snug">
              <span className="capitalize">{drink.size}</span> {RECIPE_BY_ID[drink.recipeId].name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div aria-hidden className="flex gap-1">
                {STAGES.map((_, i) => <span key={i} className={`h-1.5 w-5 rounded-full ${i <= step ? "bg-amber" : "bg-edge"}`} />)}
              </div>
              <p className="text-sm">{step < 0 ? "Not started" : `Step ${step + 1} of ${STAGES.length}: ${STAGES[step]}`}</p>
            </div>
          </>
        ) : (
          <p className="text-husk">No active ticket</p>
        )}
      </section>

      {/* 3. What was heard and the answer. It can be long, so it comes last and the fixed-height parts above never move.
          The earpiece already speaks the answer, so screen readers only announce it when the earpiece is off. */}
      <section className="w-full max-w-xl flex-1 space-y-2" aria-label="Conversation" aria-live={on ? "off" : "polite"}>
        {lastUtterance && <p className="text-husk text-base">“{lastUtterance}”</p>}
        {lastReply && <p className={`font-display text-2xl leading-snug sm:text-3xl ${lastReply.startsWith("Brain error") ? "text-error" : ""}`}>{lastReply}</p>}
        {!lastUtterance && !lastReply && <p className="text-husk font-display text-xl">{on ? "Ask for the current order to begin." : "Put the earpiece on to start your shift."}</p>}
        {error && <p role="alert" className="text-error text-base">{error}</p>}
      </section>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {!on ? (
          <button onClick={startShift} className="bg-cream text-roast font-display min-h-12 rounded-full px-7 text-base font-semibold">
            Put on earpiece and start shift
          </button>
        ) : (
          <>
            <button onClick={() => ear.interrupt()} className={BUTTON}>Interrupt (Space)</button>
            {ear.pushToTalk && (
              <button onPointerDown={() => ear.setPttHeld(true)} onPointerUp={() => ear.setPttHeld(false)} onPointerLeave={() => ear.setPttHeld(false)} onPointerCancel={() => ear.setPttHeld(false)} className={`${BUTTON} border-taro text-taro`}>
                Hold to talk (V)
              </button>
            )}
            <button onClick={() => ear.stop()} className={`${BUTTON} text-husk`}>End shift</button>
          </>
        )}
      </div>

      <Drawer onTyped={typed} earpiece={ear} rerender={rerender} />
    </main>
  );
}

/** Top-right: which model answered and how long the last turn took. For the reviewer, not the barista. */
function BrainBadge({ brain, timing }: { brain: Brain; timing: TurnTiming | null }) {
  let line: string;
  let tone = "text-husk";
  if (brain.configured === null) line = "Checking brain…";
  else if (!brain.configured) {
    line = "No LLM configured";
    tone = "text-error";
  } else if (brain.lastResult === "ok") line = `${brain.lastRespondedModel} responded, ${brain.lastLatencyMs} ms`;
  else if (brain.lastResult === "error") {
    line = `${brain.provider}/${brain.model} failed`;
    tone = "text-error";
  } else line = `${brain.provider}/${brain.model} configured, not yet used`;
  return (
    <div className="max-w-[60%] text-right text-xs">
      <p className="text-husk">Brain</p>
      <p className={tone} title={brain.lastError}>{line}</p>
      {timing && (
        <p className="text-husk tabular-nums" title="Measured from when you stopped talking">
          Last voice turn {(timing.totalMs / 1000).toFixed(1)} s
          <span className="hidden sm:inline">: wait {timing.waitMs} ms, hear {timing.hearMs} ms, think {timing.thinkMs} ms</span>
        </p>
      )}
    </div>
  );
}
