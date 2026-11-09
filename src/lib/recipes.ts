// 30 DEMO recipes. Formulations are plausible examples, not a real shop's specs.
// One function, drinkLines(), produces every measured quantity. Both the spoken recipe
// steps and the inventory deductions are built from it, so they can never disagree.

import { ITEM_BY_ID, formatQty } from "./inventory";

export type Size = "regular" | "large";
export type Sugar = 0 | 50 | 70 | 100;
export type Ice = "regular" | "less" | "none";

export interface Drink {
  recipeId: string;
  size: Size;
  sugar: Sugar;
  ice: Ice;
  toppings: string[]; // inventory item ids, category "topping"
  milk?: string; // optional milk substitution, e.g. "oat_milk"
}

type Part = [itemId: string, regularAmount: number];

export interface Recipe {
  id: string;
  name: string;
  kind: "milk" | "fruit";
  liquid: Part[]; // stage 1
  base: Part[]; // stage 2: powder, tea, purée or jam
  sweetener: string; // stage 3 syrup item; amount scales with sugar %
  sugarMl: number; // regular size at 100% sugar
  mix: string; // stage 4 wording
}

const P = "Whisk 15 seconds until no powder lumps remain.";
const T = "Stir 5 seconds to blend the tea and milk.";
const F = "Stir 8 seconds until the jam or purée fully dissolves.";

const r = (id: string, name: string, kind: Recipe["kind"], liquid: Part[], base: Part[], sweetener: string, sugarMl: number, mix: string): Recipe => ({ id, name, kind, liquid, base, sweetener, sugarMl, mix });

export const RECIPES: Recipe[] = [
  r("brown_sugar_boba", "Brown Sugar Boba Milk Tea", "milk", [["whole_milk", 250]], [["black_tea", 100]], "brown_sugar_syrup", 40, "Swirl the cup so the brown sugar streaks the walls, then stir 5 seconds."),
  r("taro_milk_tea", "Taro Milk Tea", "milk", [["whole_milk", 200]], [["taro_powder", 35], ["black_tea", 80]], "cane_syrup", 25, P),
  r("matcha_latte", "Matcha Latte", "milk", [["whole_milk", 260]], [["matcha_powder", 6], ["filtered_water", 40]], "cane_syrup", 20, "Whisk the matcha with the water 20 seconds until smooth, then combine."),
  r("thai_milk_tea", "Thai Milk Tea", "milk", [["whole_milk", 120]], [["thai_tea_mix", 25], ["filtered_water", 180]], "cane_syrup", 30, P),
  r("honeydew_milk_tea", "Honeydew Milk Tea", "milk", [["whole_milk", 200]], [["honeydew_powder", 30], ["jasmine_tea", 80]], "cane_syrup", 20, P),
  r("jasmine_milk_tea", "Jasmine Green Milk Tea", "milk", [["whole_milk", 120]], [["jasmine_tea", 200], ["milk_tea_powder", 15]], "cane_syrup", 25, T),
  r("oolong_milk_tea", "Oolong Milk Tea", "milk", [["whole_milk", 120]], [["oolong_tea", 200], ["milk_tea_powder", 15]], "cane_syrup", 25, T),
  r("mango_green_tea", "Mango Green Tea", "fruit", [["jasmine_tea", 250]], [["mango_puree", 50]], "fructose", 25, F),
  r("passionfruit_green_tea", "Passionfruit Green Tea", "fruit", [["jasmine_tea", 250]], [["passionfruit_jam", 45]], "fructose", 25, F),
  r("lychee_black_tea", "Lychee Black Tea", "fruit", [["black_tea", 260]], [["lychee_syrup", 35]], "fructose", 20, F),
  r("strawberry_milk_tea", "Strawberry Milk Tea", "milk", [["whole_milk", 200]], [["strawberry_jam", 40], ["black_tea", 80]], "cane_syrup", 15, F),
  r("wintermelon_milk_tea", "Wintermelon Milk Tea", "milk", [["whole_milk", 150]], [["wintermelon_syrup", 45], ["black_tea", 120]], "cane_syrup", 10, T),
  r("hokkaido_milk_tea", "Hokkaido Milk Tea", "milk", [["whole_milk", 200]], [["hokkaido_syrup", 30], ["black_tea", 100]], "cane_syrup", 15, T),
  r("okinawa_milk_tea", "Okinawa Milk Tea", "milk", [["whole_milk", 200]], [["okinawa_syrup", 30], ["black_tea", 100]], "cane_syrup", 10, T),
  r("coconut_milk_tea", "Coconut Milk Tea", "milk", [["coconut_milk", 150], ["whole_milk", 60]], [["black_tea", 110]], "cane_syrup", 25, T),
  r("sesame_milk_tea", "Sesame Milk Tea", "milk", [["whole_milk", 220]], [["sesame_powder", 25], ["black_tea", 80]], "honey_syrup", 25, P),
  r("earl_grey_milk_tea", "Earl Grey Milk Tea", "milk", [["whole_milk", 150]], [["earl_grey_syrup", 40], ["black_tea", 120]], "cane_syrup", 20, T),
  r("peach_oolong", "Peach Oolong", "fruit", [["oolong_tea", 250]], [["peach_puree", 45]], "fructose", 20, F),
  r("grapefruit_green_tea", "Grapefruit Green Tea", "fruit", [["jasmine_tea", 240]], [["grapefruit_jam", 50]], "fructose", 25, F),
  r("lemon_yakult", "Lemon Yakult", "fruit", [["jasmine_tea", 180]], [["yakult", 100], ["lemon_juice", 20]], "fructose", 20, "Stir 5 seconds; keep it gentle so the Yakult stays bright."),
  r("taro_lover", "Taro Lover", "milk", [["whole_milk", 230]], [["taro_powder", 45]], "cane_syrup", 20, P),
  r("dirty_matcha", "Dirty Matcha", "milk", [["whole_milk", 230]], [["matcha_powder", 6], ["coffee_powder", 6], ["filtered_water", 50]], "cane_syrup", 20, "Whisk matcha and espresso into the water separately, 15 seconds each, then layer over the milk."),
  r("caramel_milk_tea", "Caramel Milk Tea", "milk", [["whole_milk", 180]], [["caramel_syrup", 25], ["black_tea", 110]], "cane_syrup", 10, T),
  r("chocolate_milk_tea", "Chocolate Milk Tea", "milk", [["whole_milk", 200]], [["cocoa_powder", 20], ["black_tea", 90]], "cane_syrup", 25, P),
  r("rose_milk_tea", "Rose Milk Tea", "milk", [["whole_milk", 170]], [["rose_syrup", 20], ["black_tea", 120]], "cane_syrup", 15, T),
  r("almond_milk_tea", "Almond Milk Tea", "milk", [["whole_milk", 200]], [["almond_powder", 25], ["black_tea", 90]], "cane_syrup", 20, P),
  r("coffee_milk_tea", "Coffee Milk Tea", "milk", [["whole_milk", 180]], [["coffee_powder", 8], ["black_tea", 120]], "cane_syrup", 25, P),
  r("kiwi_fruit_tea", "Kiwi Fruit Tea", "fruit", [["jasmine_tea", 250]], [["kiwi_puree", 50]], "fructose", 25, F),
  r("pineapple_green_tea", "Pineapple Green Tea", "fruit", [["jasmine_tea", 250]], [["pineapple_puree", 50]], "fructose", 20, F),
  r("watermelon_jasmine", "Watermelon Jasmine", "fruit", [["jasmine_tea", 220]], [["watermelon_puree", 70]], "fructose", 15, F),
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((x) => [x.id, x]));

export const STAGES = [
  "Liquid base",
  "Powder or tea base",
  "Sugar or syrup",
  "Whisk or dissolve",
  "Ice and shake",
  "Toppings and pour",
  "Seal and serve",
] as const;

export const SIZE_ML: Record<Size, number> = { regular: 500, large: 700 };
const ICE_G: Record<Size, Record<Ice, number>> = {
  regular: { regular: 160, less: 80, none: 0 },
  large: { regular: 220, less: 110, none: 0 },
};

export interface Line {
  stage: number; // 0..6
  itemId: string | null; // null = not inventory-tracked (ice)
  amount: number; // base unit of the item
  label: string;
}

/** Scale a regular-size amount to the cup size. Large = 700/500. Liquids round to 5 ml, powders to 1 g. */
function scale(itemId: string, regular: number, size: Size): number {
  if (size === "regular") return regular;
  const raw = (regular * SIZE_ML.large) / SIZE_ML.regular;
  return ITEM_BY_ID[itemId].unit === "ml" && regular >= 20 ? Math.round(raw / 5) * 5 : Math.round(raw);
}

/** Sugar % scales the regular-size 100% syrup amount, then size scaling applies. 1 ml precision. */
export function syrupMl(recipe: Recipe, size: Size, sugar: Sugar): number {
  const full = size === "regular" ? recipe.sugarMl : (recipe.sugarMl * SIZE_ML.large) / SIZE_ML.regular;
  return Math.round((full * sugar) / 100);
}

/** THE single ingredient calculation. Everything measured comes from here. */
export function drinkLines(d: Drink): Line[] {
  const recipe = RECIPE_BY_ID[d.recipeId];
  if (!recipe) throw new Error(`Unknown recipe ${d.recipeId}`);
  const swap = (id: string) => (d.milk && ITEM_BY_ID[id].category === "milk" ? d.milk : id);
  const lines: Line[] = [];
  const add = (stage: number, itemId: string | null, amount: number, label: string) => lines.push({ stage, itemId, amount, label });

  add(0, d.size === "large" ? "cup_large" : "cup_regular", 1, `${d.size === "large" ? "large 700 ml" : "regular 500 ml"} cup`);
  for (const [id, amt] of recipe.liquid) add(0, swap(id), scale(id, amt, d.size), ITEM_BY_ID[swap(id)].name);
  for (const [id, amt] of recipe.base) add(1, swap(id), scale(id, amt, d.size), ITEM_BY_ID[swap(id)].name);
  const syrup = syrupMl(recipe, d.size, d.sugar);
  if (syrup > 0) add(2, recipe.sweetener, syrup, ITEM_BY_ID[recipe.sweetener].name);
  const ice = ICE_G[d.size][d.ice];
  if (ice > 0) add(4, null, ice, "ice");
  for (const t of d.toppings) add(5, t, 1, ITEM_BY_ID[t].name);
  add(6, "sealing_film", 1, "sealing film");
  add(6, "boba_straws", 1, "wide straw");
  return lines;
}

/** Total inventory requirement of a drink: { itemId: amount }. */
export function drinkRequirements(d: Drink): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of drinkLines(d)) if (l.itemId) out[l.itemId] = (out[l.itemId] ?? 0) + l.amount;
  return out;
}

function lineText(l: Line): string {
  if (l.itemId === null) return `${l.amount} g ${l.label}`;
  if (l.itemId.startsWith("cup_")) return `a ${l.label}`;
  const item = ITEM_BY_ID[l.itemId];
  if (item.category === "packaging") return `${l.label}`;
  if (item.category === "topping") return `1 portion of ${l.label}`;
  const qty = item.unit === "ml" ? `${l.amount} ml` : formatQty(l.itemId, l.amount);
  return `${qty} ${l.label}`;
}

/** Spoken instruction for one stage of one drink, with exact measurements. */
export function stageInstruction(d: Drink, stage: number): string {
  const recipe = RECIPE_BY_ID[d.recipeId];
  const lines = drinkLines(d).filter((l) => l.stage === stage);
  const parts = lines.map(lineText);
  const head = `Step ${stage + 1} of 7, ${STAGES[stage].toLowerCase()}:`;
  switch (stage) {
    case 0:
      return `${head} take ${parts[0]} and pour ${parts.slice(1).join(" and ")}.`;
    case 1:
      return `${head} add ${parts.join(" and ")}.`;
    case 2:
      return parts.length ? `${head} add ${parts[0]} for ${d.sugar}% sugar.` : `${head} 0% sugar, skip the syrup.`;
    case 3:
      return `${head} ${recipe.mix}`;
    case 4:
      return parts.length ? `${head} add ${parts[0]}, cap the shaker and shake 10 seconds.` : `${head} no ice; shake 5 seconds without ice.`;
    case 5:
      return parts.length ? `${head} add ${parts.join(" and ")} to the cup, then pour the drink over.` : `${head} no toppings; pour the drink into the cup.`;
    default:
      return `${head} seal with ${parts[0]}, add a ${parts[1]}, and hand it over.`;
  }
}
