// Maps a Square order (Orders API JSON) to a BobaJarvis ticket.
// Pure function: no network. Anything we can't map is reported, never guessed.

import { ITEM_BY_ID, resolveItemId } from "./inventory";
import { RECIPES, type Drink } from "./recipes";
import type { Ticket } from "./shop";

// Only the Square fields we read.
export interface SquareOrder {
  id: string;
  reference_id?: string;
  created_at?: string;
  state?: string;
  line_items?: { name?: string; quantity?: string; modifiers?: { name?: string }[] }[];
  fulfillments?: { pickup_details?: { recipient?: { display_name?: string } } }[];
}

export interface MappedOrder {
  ticket: Ticket | null;
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();

/** Square line item name -> recipe id, by exact (normalized) menu name. */
function recipeFor(name: string): string | null {
  const n = norm(name);
  return RECIPES.find((r) => norm(r.name) === n)?.id ?? null;
}

/** Apply one modifier name to a drink. Returns false if we don't understand it. */
function applyModifier(d: Drink, raw: string): boolean {
  const m = norm(raw);
  if (m === "regular" || m === "large") return (d.size = m), true;
  const sugar = /^(0|50|70|100)% ?(sugar|sweet|sweetness)?$/.exec(m);
  if (sugar) return (d.sugar = Number(sugar[1]) as Drink["sugar"]), true;
  if (/^(regular|normal) ice$/.test(m)) return (d.ice = "regular"), true;
  if (/^(less|light) ice$/.test(m)) return (d.ice = "less"), true;
  if (/^no ice$/.test(m)) return (d.ice = "none"), true;
  const id = resolveItemId(m.replace(/^(add |extra |with |sub |substitute )/, ""));
  if (id && ITEM_BY_ID[id].category === "topping") return d.toppings.push(id), true;
  if (id && ITEM_BY_ID[id].category === "milk") return (d.milk = id), true;
  return false;
}

/**
 * `id` is the display number the barista hears ("order 201"). Square order ids are long
 * strings, so we use the order's numeric reference_id when present, else the fallback.
 */
export function mapSquareOrder(o: SquareOrder, fallbackId: number): MappedOrder {
  const warnings: string[] = [];
  const drinks: Drink[] = [];
  for (const li of o.line_items ?? []) {
    const recipeId = li.name ? recipeFor(li.name) : null;
    if (!recipeId) {
      warnings.push(`"${li.name ?? "unnamed item"}" is not on the BobaJarvis menu; skipped.`);
      continue;
    }
    // Square defaults when a modifier is missing: regular, 100% sugar, regular ice.
    const base: Drink = { recipeId, size: "regular", sugar: 100, ice: "regular", toppings: [] };
    for (const mod of li.modifiers ?? []) {
      if (mod.name && !applyModifier(base, mod.name)) warnings.push(`Unknown modifier "${mod.name}" on ${li.name}; ignored.`);
    }
    const qty = Math.max(1, Math.min(20, Math.round(Number(li.quantity ?? "1")) || 1));
    for (let i = 0; i < qty; i++) drinks.push({ ...base, toppings: [...base.toppings] });
  }
  if (drinks.length === 0) return { ticket: null, warnings: [...warnings, `Square order ${o.id} has no drinks BobaJarvis knows; not imported.`] };

  const ref = Number(o.reference_id);
  return {
    ticket: {
      id: Number.isInteger(ref) && ref > 0 ? ref : fallbackId,
      customer: o.fulfillments?.[0]?.pickup_details?.recipient?.display_name?.trim() || "Guest",
      drinks,
      status: "pending",
      createdAt: o.created_at ? Date.parse(o.created_at) : Date.now(),
      deducted: false,
      credits: {},
      squareOrderId: o.id,
    },
    warnings,
  };
}
