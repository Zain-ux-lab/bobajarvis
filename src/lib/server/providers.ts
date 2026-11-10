// Server-only LLM provider calls. Keys never leave the server.
// One contract (PLAN_JSON_SCHEMA) is expressed in each provider's request format.

import { PLAN_JSON_SCHEMA } from "../actions";

export type ProviderName = "gemini" | "groq" | "openai";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  fallbackModel?: string;
  key: string;
}

// Defaults checked against provider docs on 2026-11-09. Override with *_MODEL env vars.
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: "gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-20b",
  openai: "gpt-6-luna",
};

const KEY_VARS: Record<ProviderName, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openai: "OPENAI_API_KEY" };
const MODEL_VARS: Record<ProviderName, string> = { gemini: "GEMINI_MODEL", groq: "GROQ_MODEL", openai: "OPENAI_MODEL" };

/** Pick JARVIS_PROVIDER if set, else the first provider with a key. Never a provider without a key. */
export function configuredProvider(env: Record<string, string | undefined> = process.env): ProviderConfig | null {
  const wanted = env.JARVIS_PROVIDER as ProviderName | undefined;
  const order: ProviderName[] = wanted ? [wanted] : ["groq", "gemini", "openai"]; // fastest first (see VALIDATION.md benchmark)
  for (const name of order) {
    const key = env[KEY_VARS[name]]?.trim();
    if (!key) continue;
    return { name, key, model: env[MODEL_VARS[name]]?.trim() || DEFAULT_MODELS[name], fallbackModel: name === "gemini" ? env.GEMINI_FALLBACK_MODEL?.trim() || undefined : undefined };
  }
  return null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Remove anything that looks like a credential from text we show or log. */
export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const v of Object.values(KEY_VARS)) {
    const secret = env[v];
    if (secret && secret.length > 6) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\b(sk|gsk)[-_][A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/([?&]key=)[^&\s"]+/g, "$1[redacted]");
}

export interface CallResult {
  text: string;
  model: string;
  attempts: number;
}

/**
 * Call the provider with bounded retries. The whole thing must finish before `deadline`
 * (kept shorter than the client's timeout). Daily quota exhaustion is never retried.
 */
export async function callProvider(cfg: ProviderConfig, system: string, user: string, signal: AbortSignal, deadline: number, fetchImpl: typeof fetch = fetch, maxRetries = 2): Promise<CallResult> {
  const models = [cfg.model, ...(cfg.fallbackModel ? [cfg.fallbackModel] : [])];
  let attempts = 0;
  let lastError: ProviderError | null = null;
  for (const model of models) {
    for (let retry = 0; retry <= maxRetries; retry++) {
      attempts++;
      try {
        const text = await callOnce(cfg, model, system, user, signal, deadline, fetchImpl);
        return { text, model, attempts };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        lastError = e;
        if (!e.retryable) break;
        const wait = e.retryAfterMs ?? 600 * 2 ** retry;
        if (Date.now() + wait + 1500 > deadline) break; // not enough time left for another try
        await sleep(wait, signal);
      }
    }
    // Only fall back to a second model for server-side/availability problems, not auth or quota.
    if (lastError && ![404, 500, 502, 503, 504].includes(lastError.status)) break;
  }
  throw lastError ?? new ProviderError("Provider call failed", 500, false);
}

async function callOnce(cfg: ProviderConfig, model: string, system: string, user: string, outer: AbortSignal, deadline: number, fetchImpl: typeof fetch): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ProviderError(`${cfg.name} timed out`, 504, false);
  const signal = AbortSignal.any([outer, AbortSignal.timeout(remaining)]);

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;
  if (cfg.name === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "content-type": "application/json", "x-goog-api-key": cfg.key };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: PLAN_JSON_SCHEMA } } },
    };
  } else {
    url = cfg.name === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", authorization: `Bearer ${cfg.key}` };
    body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "jarvis_plan", strict: true, schema: PLAN_JSON_SCHEMA } },
      // picking 1 of 12 actions needs little reasoning; "low" cut hidden reasoning tokens (and time) a lot
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (outer.aborted) throw e; // cancelled by the client: propagate as abort
    throw new ProviderError(`${cfg.name} network error: ${redact(String((e as Error).message ?? e))}`, 504, true);
  }
  const raw = await res.text();
  if (!res.ok) throw toProviderError(cfg.name, res, raw);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError(`${cfg.name} returned non-JSON`, 502, true);
  }
  const text = cfg.name === "gemini" ? geminiText(json) : openAiText(json);
  if (!text) throw new ProviderError(`${cfg.name} returned an empty response`, 502, true);
  return text;
}

function geminiText(json: unknown): string {
  const j = json as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

function openAiText(json: unknown): string {
  const j = json as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

export function toProviderError(name: string, res: Response, raw: string): ProviderError {
  let message = raw.slice(0, 400);
  try {
    const j = JSON.parse(raw);
    message = j?.error?.message ?? message;
  } catch {}
  const daily = /per ?day|daily|PerDay/i.test(raw);
  const retryAfterHeader = Number(res.headers.get("retry-after"));
  const geminiDelay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
  const retryAfterMs = retryAfterHeader > 0 ? retryAfterHeader * 1000 : geminiDelay ? Number(geminiDelay[1]) * 1000 : undefined;
  // Groq's strict mode returns 400 when the model's JSON misses the schema: a model hiccup, not our request's fault.
  if (res.status === 400 && /failed to generate json|does not match the expected schema/i.test(raw)) return new ProviderError(`${name} HTTP 502: model produced invalid JSON`, 502, true);
  const retryable = (res.status === 429 && !daily) || res.status >= 500;
  const prefix = res.status === 429 && daily ? "daily quota exhausted" : `HTTP ${res.status}`;
  return new ProviderError(`${name} ${prefix}: ${redact(message)}`, res.status, retryable, retryAfterMs);
}

// Groq rate-limits each model separately, so a second Groq model doubles fast capacity before we fall back to Gemini.
const GROQ_SECOND_MODEL = "openai/gpt-oss-120b";

/** Who to try, in order, when the main provider is rate-limited, down or slow. */
export function backupProviders(primary: ProviderConfig, env: Record<string, string | undefined> = process.env): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  if (primary.name === "groq" && primary.model !== GROQ_SECOND_MODEL) out.push({ ...primary, model: GROQ_SECOND_MODEL });
  for (const name of ["groq", "gemini", "openai"] as ProviderName[]) {
    if (name === primary.name) continue;
    const cfg = configuredProvider({ ...env, JARVIS_PROVIDER: name });
    if (cfg) out.push(cfg);
  }
  return out;
}

// Free tiers rate-limit hard and sometimes queue for seconds. With a backup we don't wait:
// each provider but the last gets one try and this budget, the last gets the rest of the deadline.
export const PRIMARY_BUDGET_MS = 4000;

export async function callWithBackup(chain: ProviderConfig[], system: string, user: string, signal: AbortSignal, deadline: number, fetchImpl: typeof fetch = fetch): Promise<CallResult & { provider: ProviderName }> {
  let attempts = 0;
  for (const [i, cfg] of chain.entries()) {
    const last = i === chain.length - 1;
    try {
      const r = last
        ? await callProvider(cfg, system, user, signal, deadline, fetchImpl)
        : await callProvider(cfg, system, user, signal, Math.min(deadline, Date.now() + PRIMARY_BUDGET_MS), fetchImpl, 0);
      return { ...r, attempts: attempts + r.attempts, provider: cfg.name };
    } catch (e) {
      // auth/bad-request errors are our bug, not an outage: surface them instead of hiding them behind a backup
      if (last || signal.aborted || !(e instanceof ProviderError) || !(e.status === 429 || e.status >= 500)) throw e;
      attempts++;
    }
  }
  throw new ProviderError("No provider configured", 503, false);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}
