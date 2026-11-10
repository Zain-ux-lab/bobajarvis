// Validation, provider error handling and stale-response protection.
// Provider calls use a fake fetch: this checks our handling, not the real APIs.

import { describe, expect, it } from "vitest";
import { normalizePlan } from "./actions";
import { ProviderError, backupProviders, callProvider, callWithBackup, configuredProvider, redact, toProviderError } from "./server/providers";
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

describe("model output quirks", () => {
  it("accepts a single itemId where itemIds was expected", () => {
    const r = normalizePlan({ reply: "", actions: [flat({ type: "adjust_inventory", mode: "use", itemId: "oat_milk", amount: 200, unit: "ml" })] }, "I used 200 ml of oat milk");
    expect(r.ok && r.plan.actions[0]).toMatchObject({ itemIds: ["oat_milk"] });
  });

  it("treats Groq's invalid-JSON 400 as a retryable model hiccup", () => {
    const e = toProviderError("groq", new Response("", { status: 400 }), '{"error":{"message":"Generated JSON does not match the expected schema."}}');
    expect(e).toMatchObject({ status: 502, retryable: true });
  });

  it("prefers the fastest provider when several keys exist", () => {
    expect(configuredProvider({ GEMINI_API_KEY: "a", GROQ_API_KEY: "b" })?.name).toBe("groq");
  });
});

describe("backup provider", () => {
  const groq = { name: "groq" as const, model: "g", key: "k1" };
  const gemini = { name: "gemini" as const, model: "m", key: "k2" };
  const okGemini = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"","actions":[]}' }] } }] }));
  const run = (fake: (url: string) => Response) => {
    const hosts: string[] = [];
    const f = (async (url: string) => (hosts.push(new URL(url).host), fake(url))) as unknown as typeof fetch;
    return { hosts, call: () => callWithBackup([groq, gemini], "s", "u", new AbortController().signal, Date.now() + 10_000, f) };
  };

  it("tries a second Groq model, then the other provider that has a key", () => {
    expect(backupProviders(groq, { GEMINI_API_KEY: "x" }).map((b) => `${b.name}/${b.model}`)).toEqual(["groq/openai/gpt-oss-120b", "gemini/gemini-3.5-flash-lite"]);
    expect(backupProviders(gemini, {})).toEqual([]);
  });

  it("switches to the backup straight away when the main provider is rate-limited", async () => {
    const { hosts, call } = run((url) => (url.includes("groq") ? new Response('{"error":{"message":"Rate limit reached"}}', { status: 429, headers: { "retry-after": "1" } }) : okGemini()));
    await expect(call()).resolves.toMatchObject({ provider: "gemini", model: "m", attempts: 2 });
    expect(hosts).toEqual(["api.groq.com", "generativelanguage.googleapis.com"]); // no retry wait on the main one
  });

  it("does not hide an auth error behind the backup", async () => {
    const { hosts, call } = run(() => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }));
    await expect(call()).rejects.toBeInstanceOf(ProviderError);
    expect(hosts).toEqual(["api.groq.com"]);
  });

  it("never calls the backup when the main provider answers", async () => {
    const { hosts, call } = run(() => new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"","actions":[]}' } }] })));
    await expect(call()).resolves.toMatchObject({ provider: "groq" });
    expect(hosts).toEqual(["api.groq.com"]);
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
