"use client";
// Zustand store: holds shop state and runs every turn through ONE path,
// whether the transcript came from the microphone or the typed test box.

import { create } from "zustand";
import type { Plan } from "./actions";
import { CLIENT_TIMEOUT_MS } from "./config";
import { buildContext } from "./context";
import { executePlan, withTurn } from "./executor";
import type { Drink } from "./recipes";
import { initialState, pendingTickets, type ShopState, type Ticket } from "./shop";

export interface Brain {
  configured: boolean | null; // null = not checked yet
  provider?: string;
  model?: string;
  lastResult?: "ok" | "error";
  lastRespondedModel?: string;
  lastLatencyMs?: number;
  lastError?: string;
}

interface Store {
  shop: ShopState;
  brain: Brain;
  turnId: number;
  lastUtterance: string;
  lastReply: string;
  abort: AbortController | null;
  setBrain: (b: Partial<Brain>) => void;
  /** Start a new turn id and cancel whatever was in flight. Returns the new id. */
  newTurn: () => number;
  cancelTurn: () => void;
  runTurn: (transcript: string) => Promise<string | null>;
  reset: () => void;
  addTicket: (customer: string, drinks: Drink[]) => void;
  /** Replace demo tickets with imported Square tickets; already-imported orders are kept as they are. */
  importSquareTickets: (tickets: Ticket[]) => number;
  /** Mark a completed ticket "ready for pickup" in Square. Returns "ready" or the error text. */
  syncSquareReady: (ticketId: number) => Promise<string>;
}

/** A response belongs to the past if a newer turn started or state changed since we asked. */
export function isStale(sent: { turnId: number; version: number }, now: { turnId: number; version: number }) {
  return sent.turnId !== now.turnId || sent.version !== now.version;
}

export const useShop = create<Store>((set, get) => ({
  shop: initialState(),
  brain: { configured: null },
  turnId: 0,
  lastUtterance: "",
  lastReply: "",
  abort: null,

  setBrain: (b) => set({ brain: { ...get().brain, ...b } }),

  newTurn: () => {
    get().abort?.abort();
    const id = get().turnId + 1;
    set({ turnId: id, abort: null });
    return id;
  },

  cancelTurn: () => {
    get().abort?.abort();
    set({ turnId: get().turnId + 1, abort: null });
  },

  runTurn: async (transcript) => {
    const text = transcript.trim();
    if (!text) return null;
    const turnId = get().newTurn();
    const controller = new AbortController();
    const sent = { turnId, version: get().shop.version };
    set({ abort: controller, lastUtterance: text, lastReply: "" });

    const timer = setTimeout(() => controller.abort("timeout"), CLIENT_TIMEOUT_MS);
    let res: Response;
    let body: { plan?: Plan; error?: string; model?: string; provider?: string; latencyMs?: number };
    try {
      res = await fetch("/api/jarvis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: text, turnId, stateVersion: sent.version, context: buildContext(get().shop) }),
        signal: controller.signal,
      });
      body = await res.json();
    } catch {
      clearTimeout(timer);
      if (controller.signal.reason !== "timeout") return null; // cancelled by an interrupt or newer turn
      return fail(`Brain request timed out after ${CLIENT_TIMEOUT_MS / 1000} s.`);
    }
    clearTimeout(timer);
    if (isStale(sent, { turnId: get().turnId, version: get().shop.version })) return null;

    if (!res.ok || !body.plan) return fail(body.error ?? `Brain error (HTTP ${res.status}).`, body.model);

    get().setBrain({ lastResult: "ok", lastRespondedModel: `${body.provider}/${body.model}`, lastLatencyMs: body.latencyMs, lastError: undefined });
    const before = get().shop;
    const result = executePlan(before, body.plan.actions, text, body.plan.reply);
    set({ shop: result.state, lastReply: result.speech, abort: null });

    // Tell Square about tickets this turn completed. The local completion stands either way.
    const done = result.state.tickets.filter((t) => t.squareOrderId && t.status === "completed" && before.tickets.find((b) => b.id === t.id)?.status === "pending");
    let speech = result.speech;
    for (const t of done) {
      const sync = await get().syncSquareReady(t.id);
      if (sync !== "ready") speech += ` Square wasn't updated for order ${t.id}.`;
    }
    if (speech !== result.speech) set({ lastReply: speech });
    return speech;

    function fail(error: string, model?: string) {
      // Shop state is preserved; only the conversation log records the failure.
      get().setBrain({ lastResult: "error", lastError: error, ...(model ? { lastRespondedModel: undefined } : {}) });
      const shown = `Brain error: ${error}`;
      set({ shop: withTurn(get().shop, text, shown, [], "rejected"), lastReply: shown, abort: null });
      return "Sorry, the brain request failed. The details are on screen."; // spoken; full error is displayed
    }
  },

  reset: () => {
    get().cancelTurn();
    set({ shop: initialState(), lastUtterance: "", lastReply: "" });
  },

  addTicket: (customer, drinks) => {
    const s = get().shop;
    const id = Math.max(100, ...s.tickets.map((t) => t.id)) + 1;
    const ticket = { id, customer, drinks, status: "pending" as const, createdAt: Date.now(), deducted: false, credits: {} };
    set({ shop: { ...s, version: s.version + 1, tickets: [...s.tickets, ticket], activeOrderId: s.activeOrderId ?? id } });
  },

  importSquareTickets: (incoming) => {
    const s = get().shop;
    const kept = s.tickets.filter((t) => t.squareOrderId); // drop demo tickets
    const seen = new Set(kept.map((t) => t.squareOrderId));
    const fresh = incoming.filter((t) => !seen.has(t.squareOrderId));
    const tickets = [...kept, ...fresh];
    const next = { ...s, version: s.version + 1, tickets };
    if (!tickets.some((t) => t.id === s.activeOrderId && t.status === "pending")) {
      Object.assign(next, { activeOrderId: pendingTickets(next)[0]?.id ?? null, activeDrinkIndex: 0, currentRecipeStepIndex: -1 });
    }
    set({ shop: next });
    return fresh.length;
  },

  syncSquareReady: async (ticketId) => {
    const id = get().shop.tickets.find((t) => t.id === ticketId)?.squareOrderId;
    if (!id) return "not a Square order";
    let result: string;
    try {
      const r = await fetch("/api/square/ready", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ squareOrderId: id }), signal: AbortSignal.timeout(6000) });
      const body = await r.json();
      result = r.ok ? "ready" : (body.error ?? `HTTP ${r.status}`);
    } catch (e) {
      result = `Square request failed: ${(e as Error).message}`;
    }
    // Metadata only: no version bump, so it never makes an in-flight turn look stale.
    const s = get().shop;
    set({ shop: { ...s, tickets: s.tickets.map((t) => (t.id === ticketId ? { ...t, squareSync: result } : t)) } });
    return result;
  },
}));
