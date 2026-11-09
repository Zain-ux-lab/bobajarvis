// POST /api/jarvis — turn one transcript into a validated action plan.
// It never mutates shop state; the client executor does that after validation.

import { connection } from "next/server";
import { z } from "zod";
import { normalizePlan } from "@/lib/actions";
import { SERVER_DEADLINE_MS } from "@/lib/config";
import { ProviderError, callProvider, configuredProvider, redact } from "@/lib/server/providers";
import { SYSTEM_PROMPT, userMessage } from "@/lib/server/prompt";


const BodySchema = z.object({
  transcript: z.string().trim().min(1).max(500),
  turnId: z.number().int(),
  stateVersion: z.number().int(),
  context: z.record(z.string(), z.unknown()),
});

/** Status for the brain diagnostic: which provider/model is configured. No secrets. */
export async function GET() {
  await connection(); // read env/disk at request time, not at build time
  const cfg = configuredProvider();
  return Response.json(cfg ? { configured: true, provider: cfg.name, model: cfg.model, fallbackModel: cfg.fallbackModel ?? null } : { configured: false });
}

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request body." }, { status: 400 });
  const { transcript, turnId, stateVersion, context } = parsed.data;

  const cfg = configuredProvider();
  if (!cfg) {
    return Response.json({ error: "No LLM provider configured. Add GEMINI_API_KEY (or GROQ_API_KEY / OPENAI_API_KEY) to .env.local and restart the dev server.", turnId }, { status: 503 });
  }

  const started = Date.now();
  try {
    const result = await callProvider(cfg, SYSTEM_PROMPT, userMessage(transcript, context as never), req.signal, started + SERVER_DEADLINE_MS);
    const meta = { provider: cfg.name, model: result.model, attempts: result.attempts, latencyMs: Date.now() - started, turnId, stateVersion };
    let raw: unknown;
    try {
      raw = JSON.parse(result.text);
    } catch {
      return Response.json({ ...meta, error: "Model reply was not valid JSON." }, { status: 502 });
    }
    const plan = normalizePlan(raw, transcript);
    if (!plan.ok) return Response.json({ ...meta, error: plan.error, raw }, { status: 422 });
    return Response.json({ ...meta, plan: plan.plan });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const status = e instanceof ProviderError ? e.status : 500;
    const message = redact(e instanceof Error ? e.message : String(e));
    console.error(`[jarvis] ${message}`);
    return Response.json({ error: message, provider: cfg.name, model: cfg.model, turnId, latencyMs: Date.now() - started }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
