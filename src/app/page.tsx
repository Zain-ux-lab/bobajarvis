"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Earpiece, type VoiceState } from "@/lib/earpiece";
import { RECIPE_BY_ID, STAGES } from "@/lib/recipes";
import { useShop } from "@/lib/store";

const STATE_WORD: Record<VoiceState, string> = {
  idle: "Earpiece off",
  listening: "Listening",
  transcribing: "Hearing you",
  thinking: "Thinking",
  speaking: "Speaking",
};

const HALO: Record<VoiceState, string> = {
  idle: "var(--color-leaf)",
  listening: "var(--color-taro)",
  transcribing: "var(--color-amber)",
  thinking: "var(--color-amber)",
  speaking: "var(--color-cream)",
};

export default function Home() {
  const { shop, brain, lastUtterance, lastReply, runTurn, cancelTurn, setBrain } = useShop();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState("");
  const ear = useRef<Earpiece | null>(null);
  const orb = useRef<HTMLButtonElement>(null);

  // One shared path for typed and spoken transcripts.
  const handleTranscript = useCallback(async (text: string) => {
    setError("");
    return runTurn(text);
  }, [runTurn]);

  useEffect(() => {
    const e = new Earpiece({ onTranscript: handleTranscript, onCancel: cancelTurn, onChange: rerender, onError: setError });
    ear.current = e;
    let raf = 0;
    const tick = () => {
      orb.current?.style.setProperty("--lvl", String(e.state === "listening" || e.state === "speaking" ? e.level : 0));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      e.stop(); // reliable cleanup on unmount / hot reload
    };
  }, [handleTranscript, cancelTurn]);

  useEffect(() => {
    fetch("/api/jarvis").then((r) => r.json()).then((s) => setBrain({ configured: s.configured, provider: s.provider, model: s.model })).catch(() => setBrain({ configured: false }));
  }, [setBrain]);

  // Spacebar interrupts; V is push-to-talk when that mode is on.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
    const down = (k: KeyboardEvent) => {
      if (typing(k.target)) return;
      if (k.code === "Space") {
        k.preventDefault();
        ear.current?.interrupt();
      } else if (k.code === "KeyV" && !k.repeat) ear.current?.setPttHeld(true);
    };
    const up = (k: KeyboardEvent) => {
      if (k.code === "KeyV" && !typing(k.target)) ear.current?.setPttHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const e = ear.current;
  const state: VoiceState = e?.state ?? "idle";
  const on = state !== "idle";

  const typed = async (text: string) => {
    const reply = await handleTranscript(text);
    if (reply && e && e.state !== "idle") e.say(reply);
  };

  const t = shop.tickets.find((x) => x.id === shop.activeOrderId);
  const dr = t?.drinks[shop.activeDrinkIndex];
  const subtitle = t && dr
    ? `Order ${t.id} for ${t.customer}${t.drinks.length > 1 ? `, drink ${shop.activeDrinkIndex + 1} of ${t.drinks.length}` : ""}, ${dr.size} ${RECIPE_BY_ID[dr.recipeId].name}, ${shop.currentRecipeStepIndex < 0 ? "not started" : `step ${shop.currentRecipeStepIndex + 1} of 7, ${STAGES[shop.currentRecipeStepIndex].toLowerCase()}`}`
    : "No active ticket";

  return (
    <main className="relative flex min-h-dvh flex-col items-center px-4 pb-28 pt-5">
      <header className="flex w-full max-w-5xl items-start justify-between gap-4 text-sm">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight">BobaJarvis</p>
          <p className="text-husk text-xs">Prototype with simulated shop data</p>
        </div>
        <BrainBadge />
      </header>

      <section className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8">
        <button
          ref={orb}
          onClick={() => (on ? e?.interrupt() : undefined)}
          aria-label={on ? "Interrupt and listen again" : "Earpiece is off"}
          className="relative grid size-56 place-items-center rounded-full sm:size-64"
          style={{ ["--halo" as string]: HALO[state] }}
        >
          {/* halo grows with mic / playback level */}
          <span
            className="absolute inset-0 rounded-full transition-[box-shadow] duration-300"
            style={{ boxShadow: "0 0 calc(30px + var(--lvl,0) * 90px) calc(4px + var(--lvl,0) * 26px) color-mix(in oklab, var(--halo) 55%, transparent)", animation: state === "listening" ? "breathe 3.2s ease-in-out infinite" : undefined }}
          />
          {(state === "thinking" || state === "transcribing") && (
            <span className="absolute -inset-3 rounded-full border-2 border-transparent" style={{ borderTopColor: "var(--color-amber)", animation: "spin 1.1s linear infinite" }} />
          )}
          {/* the tapioca pearl */}
          <span
            className="relative size-full rounded-full"
            style={{
              background: "radial-gradient(circle at 34% 30%, #6b5546 0%, #2b1f18 38%, #0d0907 78%)",
              boxShadow: "inset -18px -24px 40px rgba(0,0,0,.6), inset 0 0 0 2px color-mix(in oklab, var(--halo) 70%, transparent)",
              transform: "scale(calc(1 + var(--lvl,0) * 0.06))",
            }}
          >
            <span className="absolute left-[24%] top-[18%] h-[14%] w-[22%] rotate-[-28deg] rounded-full bg-white/25 blur-[2px]" />
          </span>
        </button>

        <p className="font-display text-sm" style={{ color: HALO[state] === "var(--color-leaf)" ? "var(--color-husk)" : HALO[state] }} aria-live="polite">
          {STATE_WORD[state]}
          {on && e?.pushToTalk ? ", hold V to talk" : ""}
        </p>

        <div className="w-full max-w-xl space-y-3 text-left" aria-live="polite">
          {lastUtterance && <p className="text-husk text-base">“{lastUtterance}”</p>}
          {lastReply && <p className={`font-display text-2xl leading-snug sm:text-3xl ${lastReply.startsWith("Brain error") ? "text-error" : ""}`}>{lastReply}</p>}
          {!lastUtterance && !lastReply && <p className="text-husk font-display text-xl">{on ? "Ask for the current order to begin." : "Put the earpiece on to start your shift."}</p>}
          {error && <p className="text-error text-sm">{error}</p>}
        </div>
      </section>

      <p className="text-husk mb-4 max-w-2xl text-center text-sm">{subtitle}</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {!on ? (
          <button onClick={() => { setError(""); void e?.start(); }} className="bg-cream text-roast font-display rounded-full px-7 py-3 text-base font-semibold">
            Put on earpiece and start shift
          </button>
        ) : (
          <>
            <button onClick={() => e?.interrupt()} className="border-leaf rounded-full border px-5 py-2.5 text-sm">Interrupt (Space)</button>
            {e?.pushToTalk && (
              <button onPointerDown={() => e.setPttHeld(true)} onPointerUp={() => e.setPttHeld(false)} onPointerLeave={() => e.setPttHeld(false)} className="border-taro text-taro rounded-full border px-5 py-2.5 text-sm">
                Hold to talk
              </button>
            )}
            <button onClick={() => e?.stop()} className="border-leaf text-husk rounded-full border px-5 py-2.5 text-sm">End shift</button>
          </>
        )}
      </div>

      <Drawer onTyped={typed} earpiece={e} rerender={rerender} />
    </main>
  );

  function BrainBadge() {
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
      <div className="max-w-[60%] text-right">
        <p className="text-husk text-xs">Brain</p>
        <p className={`text-xs ${tone}`} title={brain.lastError}>{line}</p>
        {e?.lastTiming && (
          <p className="text-husk text-xs tabular-nums" title="Measured from when you stopped talking">
            Last voice turn {(e.lastTiming.totalMs / 1000).toFixed(1)} s: wait {e.lastTiming.waitMs} ms, hear {e.lastTiming.hearMs} ms, think {e.lastTiming.thinkMs} ms
          </p>
        )}
      </div>
    );
  }
}
