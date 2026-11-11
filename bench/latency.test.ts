// Brain benchmark: same phrases, same prompt and schema as /api/jarvis, timed per provider/model.
// Run: npm run bench   (BENCH_CONFIGS="gemini:gemini-3.5-flash-lite,groq:openai/gpt-oss-20b" to compare)
// Makes real API calls, so it is skipped by `npm test`.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizePlan, type Action } from "@/lib/actions";
import { buildContext } from "@/lib/context";
import { DEFAULT_MODELS, backupProviders, callProvider, callWithBackup, configuredProvider, type ProviderConfig, type ProviderName } from "@/lib/server/providers";
import { SYSTEM_PROMPT, userMessage } from "@/lib/server/prompt";
import { initialState, type ShopState } from "@/lib/shop";

const fresh = initialState(0);
const midRecipe: ShopState = { ...fresh, currentRecipeStepIndex: 2, focus: "recipe" };
// The demo's real sequence: a ticket was just read aloud, its recipe not started yet.
const afterRead: ShopState = { ...fresh, focus: "ticket", turns: [{ role: "user", text: "What's the current order?" }, { role: "assistant", text: "Order 101 for Jordan: Large Brown Sugar Boba Milk Tea, 70% sugar, less ice, with tapioca pearls." }] };
const twoDrinks: ShopState = { ...fresh, activeOrderId: 102, focus: "ticket" }; // order 102 has two drinks
const afterMilk: ShopState = { ...fresh, focus: "inventory", lastMentionedInventoryItems: ["whole_milk", "oat_milk"] };

// [state, what the barista says, expected action types in order]
const CASES: [ShopState, string, string[]][] = [
  [fresh, "What's the first order I have to make?", ["read_ticket"]],
  [fresh, "What's the next order?", ["read_ticket"]],
  [fresh, "Got it. What's next?", ["continue_recipe"]],
  [afterRead, "Got it. What's next?", ["continue_recipe"]],
  [afterRead, "Got it. What is next?", ["continue_recipe"]],
  [midRecipe, "Okay next", ["continue_recipe"]],
  [midRecipe, "Done.", ["continue_recipe"]],
  [midRecipe, "Sugar?", ["order_attribute"]],
  [midRecipe, "What comes after sugar?", ["read_stage 3 after"]],
  [midRecipe, "What's step five?", ["read_stage 5 at"]],
  [midRecipe, "That order is done. What's the next order?", ["complete_ticket"]],
  [fresh, "Order 103 is ready.", ["complete_ticket"]],
  [fresh, "Thanks.", ["clarify"]],
  [fresh, "What's the second drink on order 102?", ["read_drink"]],
  [fresh, "Next drink.", ["next_drink"]],
  [fresh, "How many tarah drinks are waiting?", ["count_queue"]],
  [fresh, "How much milk do we have?", ["query_inventory"]],
  [afterMilk, "What about oat?", ["query_inventory"]],
  [afterMilk, "Restock those.", ["restock_mentioned"]],
  [fresh, "I used 200 ml of oat milk.", ["adjust_inventory"]],
  [fresh, "How much fruit to us do we have?", ["query_inventory"]],
  [fresh, "Does this one have toppings?", ["order_attribute"]],
  [twoDrinks, "How do you make the second drink?", ["read_drink", "read_stage 1 at"]],
  [fresh, "How do I make this?", ["read_stage 1 at"]],
  [fresh, "What's the stock level like?", ["query_inventory"]],
  [fresh, "Check all the stock.", ["query_inventory"]],
];

// Also correct: "Thanks." with no action; the executor drops a read_ticket that follows a completion.
const OK_ALTERNATIVES: Record<string, string[]> = { "Thanks.": ["clarify", ""], "How do I make this?": ["continue_recipe"], "That order is done. What's the next order?": ["complete_ticket,read_ticket"] };

// "backup:groq" = the app's real setup: groq first, the other keyed provider as instant backup
function configs(): (ProviderConfig & { backup?: ProviderConfig[] })[] {
  const base = configuredProvider();
  const list = process.env.BENCH_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list) return base ? [base] : [];
  return list.flatMap((entry) => {
    if (entry.startsWith("backup:")) {
      const main = configuredProvider({ ...process.env, JARVIS_PROVIDER: entry.slice(7) });
      return main ? [{ ...main, name: main.name, backup: backupProviders(main) }] : [];
    }
    const [name, model] = entry.split(":", 2) as [ProviderName, string | undefined];
    const cfg = configuredProvider({ ...process.env, JARVIS_PROVIDER: name });
    if (!cfg) {
      console.warn(`skip ${entry}: no key`);
      return [];
    }
    return [{ name, model: model || DEFAULT_MODELS[name], key: cfg.key }];
  });
}

const GAP_MS = Number(process.env.BENCH_GAP_MS ?? 4000);
const pct =(xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))];

describe.skipIf(!process.env.BENCH)("brain latency", () => {
  it("benchmarks each config", { timeout: 600_000 }, async () => {
    const rounds = Number(process.env.BENCH_ROUNDS ?? 1);
    const rows: string[] = [];
    for (const cfg of configs()) {
      const ms: number[] = [];
      let correct = 0, retries = 0, failed = 0, usedBackup = 0;
      const wrong: string[] = [];
      // one untimed warm-up call (DNS, TLS, cold model)
      await callProvider(cfg, SYSTEM_PROMPT, userMessage("Hi", buildContext(fresh)), AbortSignal.timeout(20_000), Date.now() + 20_000).catch(() => {});
      for (let r = 0; r < rounds; r++) {
        for (const [state, text, expected] of CASES) {
          await new Promise((r) => setTimeout(r, GAP_MS)); // stay under free-tier requests-per-minute limits
          const t0 = performance.now();
          try {
            const user = userMessage(text, buildContext(state));
            const res = cfg.backup !== undefined
              ? await callWithBackup([cfg, ...cfg.backup], SYSTEM_PROMPT, user, AbortSignal.timeout(20_000), Date.now() + 14_000)
              : await callProvider(cfg, SYSTEM_PROMPT, user, AbortSignal.timeout(20_000), Date.now() + 20_000);
            if ("provider" in res && res.attempts > 1) usedBackup++;
            ms.push(performance.now() - t0);
            retries += res.attempts - 1;
            const plan = normalizePlan(JSON.parse(res.text), text);
            // read_stage also checks the stage number: "after sugar" must be stage 3, not the answer 4
            const got = plan.ok ? plan.plan.actions.map((a: Action) => (a.type === "read_stage" ? `read_stage ${a.stage} ${a.relation}` : a.type)).join(",") : `invalid(${plan.error})`;
            const ok = got === expected.join(",") || (OK_ALTERNATIVES[text] ?? []).includes(got);
            if (ok) correct++;
            else wrong.push(`"${text}" -> ${got}`);
          } catch (e) {
            failed++;
            wrong.push(`"${text}" -> error ${(e as Error).message.slice(0, 80)}`);
          }
        }
      }
      const n = CASES.length * rounds;
      rows.push(`| ${cfg.name}/${cfg.model}${cfg.backup ? ` → ${cfg.backup.map((b) => b.model).join(" → ")} (backup used ${usedBackup}x)` : ""} | ${Math.round(pct(ms, 50))} | ${Math.round(pct(ms, 90))} | ${Math.round(Math.max(...ms))} | ${correct}/${n} | ${retries} | ${failed} |`);
      if (wrong.length) rows.push(`|   wrong: ${wrong.slice(0, 4).join("; ")}${wrong.length > 4 ? ` (+${wrong.length - 4} more)` : ""} |`);
    }
    const table = ["| Config | median ms | p90 ms | max ms | correct | retries | errors |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
    writeFileSync(new URL(`./${process.env.BENCH_OUT ?? "last-run"}.md`, import.meta.url), `${new Date().toISOString()}, ${rounds} round(s)\n\n${table}\n`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
