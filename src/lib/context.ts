// Compact snapshot of shop state sent to /api/jarvis with each turn.
// Each fact appears once; the full recipe formulations stay in the app.

import { ITEMS, formatQty } from "./inventory";
import { RECIPES, STAGES } from "./recipes";
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
  inventory: string[]; // "oat_milk (milk): 1.4 L, 18%"
  recipes: string[]; // "taro_milk_tea: Taro Milk Tea"
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
    inventory: ITEMS.map((i) => `${i.id} (${i.category}): ${formatQty(i.id, s.inventory[i.id])}, ${Math.round((s.inventory[i.id] / i.capacity) * 100)}%`),
    recipes: RECIPES.map((r) => `${r.id}: ${r.name}`),
    recentTurns: s.turns,
  };
}
