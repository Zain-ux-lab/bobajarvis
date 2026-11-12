// Compact snapshot of shop state sent to /api/jarvis with each turn.
// Only what changes between turns. Fixed ids (items, recipes) live in the system prompt,
// and quantities never go to the model at all: the app states every number itself.

import { STAGES } from "./recipes";
import { drinkText, pendingTickets, type ShopState } from "./shop";

export interface JarvisContext {
  active: {
    orderId: number | null;
    drinkIndex: number; // 1-based
    drinkCount: number;
    drink: string | null;
    size: string | null;
    recipeStep: string; // "not started" or "3 of 7 (Sugar or syrup)"
  };
  focus: ShopState["focus"];
  lastMentionedInventoryItems: string[];
  pendingTickets: { id: number; customer: string; drinks: string[] }[];
  recentlyCompleted: number[];
  recentTurns: ShopState["turns"];
}

export function buildContext(s: ShopState): JarvisContext {
  const t = s.tickets.find((x) => x.id === s.activeOrderId);
  const dr = t?.drinks[s.activeDrinkIndex];
  const step = s.currentRecipeStepIndex;
  return {
    active: {
      orderId: t?.id ?? null,
      drinkIndex: s.activeDrinkIndex + 1,
      drinkCount: t?.drinks.length ?? 0,
      drink: dr ? drinkText(dr) : null,
      size: dr?.size ?? null,
      recipeStep: step < 0 ? "not started" : `${step + 1} of 7 (${STAGES[step]})`,
    },
    focus: s.focus,
    lastMentionedInventoryItems: s.lastMentionedInventoryItems,
    pendingTickets: pendingTickets(s).map((p) => ({ id: p.id, customer: p.customer, drinks: p.drinks.map(drinkText) })),
    recentlyCompleted: s.tickets.filter((x) => x.status === "completed").map((x) => x.id).slice(-3),
    // Last 3 exchanges, long replies shortened: enough for "what about oat?", and every token here is
    // sent on every request (Groq's free tier limits tokens per minute). "Restock those" uses state, not this.
    recentTurns: s.turns.slice(-6).map((t) => (t.text.length > 140 ? { ...t, text: `${t.text.slice(0, 137)}...` } : t)),
  };
}
