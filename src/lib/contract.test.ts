// Validation, provider error handling and stale-response protection.
// Provider calls use a fake fetch: this checks our handling, not the real APIs.

import { describe, expect, it } from "vitest";
import { normalizePlan } from "./actions";
import { ProviderError, callProvider, configuredProvider, redact, toProviderError } from "./server/providers";
import { isStale } from "./store";
import { encodeWav } from "./wav";

const flat = (o: Record<string, unknown>) => ({ type: null, target: null, orderId: null, drinkIndex: null, attribute: null, stage: null, relation: null, recipeId: null, itemId: null, itemIds: null, category: null, mode: null, amount: null, unit: null, completionEvidence: null, question: null, ...o });

describe("normalizePlan", () => {
  it("accepts a flat provider plan and drops nulls", () => {
    const r = normalizePlan({ reply: "", actions: [flat({ type: "continue_recipe" })] }, "next");
    expect(r).toEqual({ ok: true, plan: { reply: "", actions: [{ type: "continue_recipe" }] } });
  });
  it("rejects unknown action types", () => {
    expect(normalizePlan({ reply: "", actions: [flat({ type: "make_coffee" })] }, "x").ok).toBe(false);
  });
  it("rejects invalid quantities and indices", () => {
    expect(normalizePlan({ reply: "", actions: [flat({ type: "adjust_inventory", mode: "use", itemIds: ["oat_milk"], amount: -5, unit: "ml" })] }, "x").ok).toBe(false);
    expect(normalizePlan({ reply: "", actions: [flat({ type: "read_drink", drinkIndex: 0 })] }, "x").ok).toBe(false);
  });
  it("requires completion evidence quoted from the transcript", () => {
    expect(normalizePlan({ reply: "", actions: [flat({ type: "complete_ticket", completionEvidence: "order is ready" })] }, "Got it, what's next?").ok).toBe(false);
    expect(normalizePlan({ reply: "", actions: [flat({ type: "complete_ticket", completionEvidence: "order 104 is ready" })] }, "Okay, order 104 is ready.").ok).toBe(true);
  });
  it("rejects two completions in one plan", () => {
    const c = flat({ type: "complete_ticket", completionEvidence: "done" });
    expect(normalizePlan({ reply: "", actions: [c, c] }, "done done").ok).toBe(false);
  });
});

describe("providers", () => {
  it("never selects a provider without a key", () => {
    expect(configuredProvider({})).toBeNull();
    expect(configuredProvider({ GROQ_API_KEY: "gsk_test", JARVIS_PROVIDER: "gemini" })).toBeNull();
    expect(configuredProvider({ GROQ_API_KEY: "gsk_test" })?.name).toBe("groq");
  });

  it("redacts keys from messages", () => {
    const env = { GEMINI_API_KEY: "AIzaFAKEFAKEFAKEFAKEFAKEFAKE1234" };
    expect(redact("bad key AIzaFAKEFAKEFAKEFAKEFAKEFAKE1234 and ?key=abc", env)).toBe("bad key [redacted] and ?key=[redacted]");
    expect(redact("Bearer sk-proj-abcdefghijklmnop", {})).toBe("Bearer [redacted]");
  });

  it("does not retry daily quota exhaustion", () => {
    const res = new Response("", { status: 429 });
    const e = toProviderError("gemini", res, JSON.stringify({ error: { message: "Quota exceeded for GenerateRequestsPerDayPerProjectPerModel" } }));
    expect(e.retryable).toBe(false);
    expect(e.message).toContain("daily quota");
  });

  it("retries a transient 503 within the deadline and reports the model", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503, headers: { "retry-after": "0.01" } });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"","actions":[]}' }] } }] }));
    }) as typeof fetch;
    const r = await callProvider({ name: "gemini", model: "m1", key: "k" }, "s", "u", new AbortController().signal, Date.now() + 10_000, fake);
    expect(r).toMatchObject({ model: "m1", attempts: 2 });
  });

  it("surfaces auth errors without retrying", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 });
    }) as typeof fetch;
    await expect(callProvider({ name: "gemini", model: "m1", fallbackModel: "m2", key: "k" }, "s", "u", new AbortController().signal, Date.now() + 10_000, fake)).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });
});

describe("stale response protection", () => {
  it("drops responses from an older turn or an older state snapshot", () => {
    expect(isStale({ turnId: 3, version: 5 }, { turnId: 3, version: 5 })).toBe(false);
    expect(isStale({ turnId: 3, version: 5 }, { turnId: 4, version: 5 })).toBe(true);
    expect(isStale({ turnId: 3, version: 5 }, { turnId: 3, version: 6 })).toBe(true);
  });
});

describe("wav", () => {
  it("encodes a valid 16 kHz mono PCM header", () => {
    const buf = encodeWav(new Float32Array(16000));
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(buf.byteLength).toBe(44 + 32000);
  });
});
