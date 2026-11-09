// SIMULATED inventory catalogue. Not connected to any real shop system.
// Quantities are stored in a base unit: ml for liquids, g for powders,
// portions for toppings, units for packaging. Display converts ml -> L for milks/teas.

export type Category = "milk" | "tea" | "water" | "powder" | "syrup" | "topping" | "packaging";
export type BaseUnit = "ml" | "g" | "portion" | "unit";

export interface ItemDef {
  id: string;
  name: string;
  category: Category;
  unit: BaseUnit;
  capacity: number; // reference capacity, used for the 15% low-stock line
  start: number; // seed quantity
  displayLitres?: boolean;
  aliases?: string[]; // small speech-mishearing dictionary
}

const L = 1000;

export const ITEMS: ItemDef[] = [
  // Milks (litres)
  { id: "whole_milk", name: "whole milk", category: "milk", unit: "ml", capacity: 12 * L, start: 8 * L, displayLitres: true, aliases: ["regular milk", "dairy milk"] },
  { id: "oat_milk", name: "oat milk", category: "milk", unit: "ml", capacity: 8 * L, start: 1.4 * L, displayLitres: true, aliases: ["oat", "oats", "oak milk"] },
  { id: "lactose_free_milk", name: "lactose-free milk", category: "milk", unit: "ml", capacity: 6 * L, start: 4 * L, displayLitres: true, aliases: ["lactose free", "lacto free"] },
  { id: "soy_milk", name: "soy milk", category: "milk", unit: "ml", capacity: 6 * L, start: 3 * L, displayLitres: true, aliases: ["soya", "soy"] },
  { id: "coconut_milk", name: "coconut milk", category: "milk", unit: "ml", capacity: 4 * L, start: 2.5 * L, displayLitres: true, aliases: ["coconut"] },
  // Brewed teas (litres)
  { id: "black_tea", name: "brewed black tea", category: "tea", unit: "ml", capacity: 10 * L, start: 7 * L, displayLitres: true, aliases: ["black tea", "assam"] },
  { id: "jasmine_tea", name: "brewed jasmine green tea", category: "tea", unit: "ml", capacity: 10 * L, start: 6 * L, displayLitres: true, aliases: ["green tea", "jasmine", "jazz mean"] },
  { id: "oolong_tea", name: "brewed oolong tea", category: "tea", unit: "ml", capacity: 8 * L, start: 5 * L, displayLitres: true, aliases: ["oolong", "oo long", "who long"] },
  { id: "filtered_water", name: "filtered water", category: "water", unit: "ml", capacity: 20 * L, start: 18 * L, displayLitres: true, aliases: ["water"] },
  // Powders (grams)
  { id: "taro_powder", name: "taro powder", category: "powder", unit: "g", capacity: 2000, start: 1200, aliases: ["taro", "tarah", "terra", "tara"] },
  { id: "matcha_powder", name: "matcha powder", category: "powder", unit: "g", capacity: 1000, start: 600, aliases: ["matcha", "match a", "macha"] },
  { id: "thai_tea_mix", name: "Thai tea mix", category: "powder", unit: "g", capacity: 1500, start: 900, aliases: ["thai tea", "tie tea"] },
  { id: "milk_tea_powder", name: "milk tea creamer powder", category: "powder", unit: "g", capacity: 3000, start: 2200, aliases: ["creamer", "non-dairy creamer"] },
  { id: "cocoa_powder", name: "cocoa powder", category: "powder", unit: "g", capacity: 1500, start: 800, aliases: ["chocolate powder", "cocoa"] },
  { id: "sesame_powder", name: "black sesame powder", category: "powder", unit: "g", capacity: 1000, start: 500, aliases: ["sesame"] },
  { id: "honeydew_powder", name: "honeydew powder", category: "powder", unit: "g", capacity: 1000, start: 550, aliases: ["honeydew", "honey do"] },
  { id: "almond_powder", name: "almond powder", category: "powder", unit: "g", capacity: 800, start: 400, aliases: ["almond"] },
  { id: "coffee_powder", name: "instant espresso powder", category: "powder", unit: "g", capacity: 600, start: 350, aliases: ["coffee", "espresso"] },
  // Syrups, jams, purées (ml)
  { id: "cane_syrup", name: "cane sugar syrup", category: "syrup", unit: "ml", capacity: 4000, start: 2600, aliases: ["simple syrup", "sugar syrup", "cane sugar"] },
  { id: "fructose", name: "fructose syrup", category: "syrup", unit: "ml", capacity: 4000, start: 2000, aliases: ["fruit to us", "fruit toast", "fructose syrup", "fruit toes"] },
  { id: "brown_sugar_syrup", name: "brown sugar syrup", category: "syrup", unit: "ml", capacity: 3000, start: 1800, aliases: ["brown sugar", "black sugar"] },
  { id: "honey_syrup", name: "honey syrup", category: "syrup", unit: "ml", capacity: 2000, start: 1100, aliases: ["honey"] },
  { id: "caramel_syrup", name: "caramel syrup", category: "syrup", unit: "ml", capacity: 1500, start: 700, aliases: ["caramel"] },
  { id: "rose_syrup", name: "rose syrup", category: "syrup", unit: "ml", capacity: 1000, start: 450, aliases: ["rose"] },
  { id: "wintermelon_syrup", name: "wintermelon syrup", category: "syrup", unit: "ml", capacity: 2000, start: 1000, aliases: ["winter melon", "wintermelon"] },
  { id: "earl_grey_syrup", name: "Earl Grey concentrate", category: "syrup", unit: "ml", capacity: 1500, start: 700, aliases: ["earl grey", "early grey"] },
  { id: "mango_puree", name: "mango purée", category: "syrup", unit: "ml", capacity: 2000, start: 1100, aliases: ["mango"] },
  { id: "passionfruit_jam", name: "passion fruit jam", category: "syrup", unit: "ml", capacity: 1500, start: 800, aliases: ["passion fruit", "passionfruit"] },
  { id: "lychee_syrup", name: "lychee syrup", category: "syrup", unit: "ml", capacity: 1500, start: 750, aliases: ["lychee", "lee chee"] },
  { id: "strawberry_jam", name: "strawberry jam", category: "syrup", unit: "ml", capacity: 1500, start: 800, aliases: ["strawberry"] },
  { id: "peach_puree", name: "peach purée", category: "syrup", unit: "ml", capacity: 1500, start: 700, aliases: ["peach"] },
  { id: "grapefruit_jam", name: "grapefruit jam", category: "syrup", unit: "ml", capacity: 1500, start: 650, aliases: ["grapefruit"] },
  { id: "lemon_juice", name: "lemon juice", category: "syrup", unit: "ml", capacity: 1500, start: 900, aliases: ["lemon"] },
  { id: "kiwi_puree", name: "kiwi purée", category: "syrup", unit: "ml", capacity: 1500, start: 600, aliases: ["kiwi"] },
  { id: "pineapple_puree", name: "pineapple purée", category: "syrup", unit: "ml", capacity: 1500, start: 700, aliases: ["pineapple"] },
  { id: "watermelon_puree", name: "watermelon purée", category: "syrup", unit: "ml", capacity: 2000, start: 1000, aliases: ["watermelon"] },
  { id: "yakult", name: "Yakult", category: "syrup", unit: "ml", capacity: 3000, start: 1500, aliases: ["yakult", "ya cult"] },
  { id: "okinawa_syrup", name: "Okinawa kokuto syrup", category: "syrup", unit: "ml", capacity: 1500, start: 800, aliases: ["okinawa", "kokuto"] },
  { id: "hokkaido_syrup", name: "Hokkaido caramel cream syrup", category: "syrup", unit: "ml", capacity: 1500, start: 750, aliases: ["hokkaido"] },
  // Toppings (portions)
  { id: "tapioca", name: "tapioca pearls", category: "topping", unit: "portion", capacity: 80, start: 40, aliases: ["boba", "pearls", "tapioca pearls"] },
  { id: "popping_boba", name: "popping boba", category: "topping", unit: "portion", capacity: 60, start: 30, aliases: ["popping pearls", "bursting boba"] },
  { id: "lychee_jelly", name: "lychee jelly", category: "topping", unit: "portion", capacity: 60, start: 28, aliases: ["jelly", "coconut jelly"] },
  { id: "aloe", name: "aloe vera", category: "topping", unit: "portion", capacity: 40, start: 20, aliases: ["aloe", "aloe vera"] },
  { id: "pudding", name: "egg pudding", category: "topping", unit: "portion", capacity: 40, start: 7, aliases: ["pudding"] },
  { id: "cheese_foam", name: "cheese foam", category: "topping", unit: "portion", capacity: 40, start: 18, aliases: ["cheese foam", "cream cheese foam", "salty foam"] },
  // Packaging (units)
  { id: "cup_regular", name: "regular 500 ml cups", category: "packaging", unit: "unit", capacity: 300, start: 180, aliases: ["regular cups", "small cups"] },
  { id: "cup_large", name: "large 700 ml cups", category: "packaging", unit: "unit", capacity: 300, start: 150, aliases: ["large cups", "big cups"] },
  { id: "sealing_film", name: "sealing film", category: "packaging", unit: "unit", capacity: 1000, start: 600, aliases: ["film", "seal film", "lids"] },
  { id: "boba_straws", name: "wide boba straws", category: "packaging", unit: "unit", capacity: 500, start: 260, aliases: ["straws"] },
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const CATEGORIES: Category[] = ["milk", "tea", "water", "powder", "syrup", "topping", "packaging"];
export const TOPPING_IDS = ITEMS.filter((i) => i.category === "topping").map((i) => i.id);
export const MILK_IDS = ITEMS.filter((i) => i.category === "milk").map((i) => i.id);

export const LOW_STOCK_RATIO = 0.15;

export function seedInventory(): Record<string, number> {
  return Object.fromEntries(ITEMS.map((i) => [i.id, i.start]));
}

/** Resolve an id, name, or alias (e.g. "tarah", "fruit to us") to a catalogue id. Unknown -> null. */
export function resolveItemId(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[_-]/g, " ");
  for (const item of ITEMS) {
    if (item.id.replace(/_/g, " ") === t || item.name.toLowerCase() === t) return item.id;
  }
  for (const item of ITEMS) {
    if (item.aliases?.some((a) => a.toLowerCase() === t)) return item.id;
  }
  return null;
}

/** Human-readable quantity, e.g. "1.4 L", "600 g", "7 portions". */
export function formatQty(id: string, qty: number): string {
  const item = ITEM_BY_ID[id];
  if (item.displayLitres) return `${round(qty / 1000, 2)} L`;
  if (item.unit === "ml") return `${Math.round(qty)} ml`;
  if (item.unit === "g") return `${Math.round(qty)} g`;
  if (item.unit === "portion") return `${round(qty, 1)} ${qty === 1 ? "portion" : "portions"}`;
  return `${Math.round(qty)} ${qty === 1 ? "unit" : "units"}`;
}

/** Convert an amount spoken in some unit to the item's base unit. Returns null if incompatible. */
export function toBaseUnit(id: string, amount: number, unit: string): number | null {
  const item = ITEM_BY_ID[id];
  const u = unit.toLowerCase();
  if (item.unit === "ml") {
    if (u === "ml" || u === "millilitres" || u === "milliliters") return amount;
    if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return amount * 1000;
    return null;
  }
  if (item.unit === "g") {
    if (u === "g" || u === "grams" || u === "gram") return amount;
    if (u === "kg" || u === "kilograms" || u === "kilogram") return amount * 1000;
    return null;
  }
  if (item.unit === "portion") return ["portion", "portions", "scoop", "scoops", "serving", "servings"].includes(u) ? amount : null;
  return ["unit", "units", "piece", "pieces", "pcs"].includes(u) ? amount : null;
}

function round(n: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
