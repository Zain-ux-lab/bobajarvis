// The action contract between the LLM and the app.
// The LLM only *proposes* these. src/lib/executor.ts decides what actually changes.

import { z } from "zod";
import { CATEGORIES } from "./inventory";

export const ACTION_TYPES = [
  "read_ticket",
  "next_drink",
  "read_drink",
  "count_queue",
  "order_attribute",
  "continue_recipe",
  "read_stage",
  "complete_ticket",
  "query_inventory",
  "adjust_inventory",
  "restock_mentioned",
  "clarify",
] as const;

const orderId = z.number().int().positive();
const categoryEnum = z.enum(CATEGORIES as [string, ...string[]]);

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read_ticket"), target: z.enum(["current", "next", "first", "latest", "specific"]), orderId: orderId.optional() }),
  z.object({ type: z.literal("next_drink") }),
  z.object({ type: z.literal("read_drink"), orderId: orderId.optional(), drinkIndex: z.number().int().min(1) }),
  z.object({ type: z.literal("count_queue"), recipeId: z.string().optional(), itemId: z.string().optional() }),
  z.object({
    type: z.literal("order_attribute"),
    attribute: z.enum(["sugar", "ice", "toppings", "size", "milk", "drink", "customer"]),
    orderId: orderId.optional(),
    drinkIndex: z.number().int().min(1).optional(),
  }),
  z.object({ type: z.literal("continue_recipe") }),
  z.object({ type: z.literal("read_stage"), stage: z.number().int().min(1).max(7), relation: z.enum(["at", "after", "before"]) }),
  z.object({ type: z.literal("complete_ticket"), orderId: orderId.optional(), completionEvidence: z.string().min(1) }),
  z.object({ type: z.literal("query_inventory"), itemIds: z.array(z.string()).optional(), category: categoryEnum.optional() }),
  z.object({
    type: z.literal("adjust_inventory"),
    mode: z.enum(["use", "add", "replenish"]),
    itemIds: z.array(z.string()).min(1),
    amount: z.number().positive().optional(),
    unit: z.string().optional(),
    orderId: orderId.optional(),
  }),
  z.object({ type: z.literal("restock_mentioned") }),
  z.object({ type: z.literal("clarify"), question: z.string().min(1) }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const PlanSchema = z.object({
  reply: z.string(),
  actions: z.array(ActionSchema).max(4),
});
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Provider-facing JSON Schema. It is deliberately FLAT (one object, nullable fields)
 * because Gemini/OpenAI/Groq all handle that reliably; nested unions are often rejected.
 * normalizePlan() turns it into the discriminated union above and validates it.
 */
const nullable = (type: string, extra: object = {}) => ({ type: [type, "null"], ...extra });
const ACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: [...ACTION_TYPES] },
    target: nullable("string", { enum: ["current", "next", "first", "latest", "specific", null] }),
    orderId: nullable("integer"),
    drinkIndex: nullable("integer", { description: "1-based drink position within the ticket" }),
    attribute: nullable("string", { enum: ["sugar", "ice", "toppings", "size", "milk", "drink", "customer", null] }),
    stage: nullable("integer", { description: "1-7 recipe stage the user referred to" }),
    relation: nullable("string", { enum: ["at", "after", "before", null] }),
    recipeId: nullable("string"),
    itemId: nullable("string", { description: "inventory item id, e.g. taro_powder to count all taro drinks" }),
    itemIds: { type: ["array", "null"], items: { type: "string" } },
    category: nullable("string", { enum: [...CATEGORIES, null] }),
    mode: nullable("string", { enum: ["use", "add", "replenish", null] }),
    amount: nullable("number"),
    unit: nullable("string"),
    completionEvidence: nullable("string", { description: "Verbatim words from the CURRENT transcript that explicitly say the order is finished" }),
    question: nullable("string"),
  },
  required: ["type", "target", "orderId", "drinkIndex", "attribute", "stage", "relation", "recipeId", "itemId", "itemIds", "category", "mode", "amount", "unit", "completionEvidence", "question"],
};

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "Very short conversational reply. Never state quantities or ticket details here; the app speaks facts." },
    actions: { type: "array", items: ACTION_JSON_SCHEMA },
  },
  required: ["reply", "actions"],
};

export type NormalizeResult = { ok: true; plan: Plan } | { ok: false; error: string };

/** Parse raw model JSON -> validated Plan. Drops nulls, validates types, checks completion grounding. */
export function normalizePlan(raw: unknown, transcript: string): NormalizeResult {
  const stripped = stripNulls(raw) as { actions?: Record<string, unknown>[] };
  // The flat schema has both itemId and itemIds; models sometimes fill the singular one for a single item.
  for (const a of Array.isArray(stripped?.actions) ? stripped.actions : []) {
    if ((a.type === "adjust_inventory" || a.type === "query_inventory") && a.itemIds === undefined && typeof a.itemId === "string") a.itemIds = [a.itemId];
  }
  const parsed = PlanSchema.safeParse(stripped);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Model returned an invalid action plan (${issue.path.join(".") || "root"}: ${issue.message}).` };
  }
  const completions = parsed.data.actions.filter((a) => a.type === "complete_ticket");
  if (completions.length > 1) return { ok: false, error: "Model proposed more than one completion in a single utterance; rejected." };
  for (const a of completions) {
    if (!evidenceInTranscript(a.completionEvidence, transcript)) {
      return { ok: false, error: `Completion rejected: evidence "${a.completionEvidence}" is not a quote from what you said.` };
    }
  }
  return { ok: true, plan: parsed.data };
}

/** Grounding check only: the quote must literally appear in the transcript (case/punctuation-insensitive). */
export function evidenceInTranscript(evidence: string, transcript: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%' ]+/g, " ").replace(/\s+/g, " ").trim();
  const e = norm(evidence);
  return e.length >= 3 && norm(transcript).includes(e);
}

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  }
  return v;
}
