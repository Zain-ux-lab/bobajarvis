// Shop state shape, SIMULATED seed tickets, and factual text formatting.

import { seedInventory, ITEM_BY_ID } from "./inventory";
import { RECIPE_BY_ID, SIZE_ML, type Drink } from "./recipes";

export interface Ticket {
  id: number;
  customer: string;
  drinks: Drink[];
  status: "pending" | "completed";
  createdAt: number;
  completedAt?: number;
  deducted: boolean; // completion deduction already applied (prevents double deductions)
  credits: Record<string, number>; // manual usage already logged against this ticket
  squareOrderId?: string; // set when imported from the Square sandbox
  squareSync?: string; // "ready" once Square shows it ready for pickup, otherwise the last error
}

export type Focus = "ticket" | "recipe" | "inventory" | "queue" | null;

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface LogEntry {
  at: number;
  transcript: string;
  actions: unknown[];
  result: "applied" | "rolled_back" | "rejected";
  speech: string;
}

export interface ShopState {
  version: number; // bumped on every applied turn; used to discard stale responses
  tickets: Ticket[];
  inventory: Record<string, number>;
  tapiocaCookedAt: number;
  activeOrderId: number | null;
  activeDrinkIndex: number; // 0-based
  currentRecipeStepIndex: number; // -1 = not started, 0..6
  focus: Focus;
  lastMentionedInventoryItems: string[];
  turns: Turn[]; // last 10
  log: LogEntry[];
}

const d = (recipeId: string, size: Drink["size"], sugar: Drink["sugar"], ice: Drink["ice"], toppings: string[], milk?: string): Drink => ({ recipeId, size, sugar, ice, toppings, ...(milk ? { milk } : {}) });

export function seedTickets(now = Date.now()): Ticket[] {
  const t = (id: number, customer: string, minsAgo: number, drinks: Drink[]): Ticket => ({ id, customer, drinks, status: "pending", createdAt: now - minsAgo * 60_000, deducted: false, credits: {} });
  return [
    t(101, "Jordan", 9, [d("brown_sugar_boba", "large", 70, "less", ["tapioca"])]),
    t(102, "Priya", 7, [d("matcha_latte", "regular", 50, "regular", [], "oat_milk"), d("mango_green_tea", "large", 100, "none", ["popping_boba", "aloe"])]),
    t(103, "Leo", 5, [d("thai_milk_tea", "regular", 100, "regular", ["pudding"])]),
    t(104, "Maya", 3, [d("taro_milk_tea", "large", 50, "less", ["tapioca"])]),
    t(105, "Sam", 1, [d("lemon_yakult", "regular", 70, "less", ["lychee_jelly"]), d("taro_lover", "regular", 0, "none", ["cheese_foam"], "lactose_free_milk")]),
  ];
}

export function initialState(now = Date.now()): ShopState {
  return {
    version: 0,
    tickets: seedTickets(now),
    inventory: seedInventory(),
    tapiocaCookedAt: now - 95 * 60_000,
    activeOrderId: 101,
    activeDrinkIndex: 0,
    currentRecipeStepIndex: -1,
    focus: null,
    lastMentionedInventoryItems: [],
    turns: [],
    log: [],
  };
}

export const pendingTickets = (s: ShopState) => s.tickets.filter((t) => t.status === "pending").sort((a, b) => a.createdAt - b.createdAt);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ICE_TEXT = { regular: "regular ice", less: "less ice", none: "no ice" } as const;

export function toppingText(ids: string[]): string {
  if (ids.length === 0) return "no toppings";
  const names = ids.map((id) => ITEM_BY_ID[id].name);
  return `with ${names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names.at(-1)}`;
}

/** "Large Taro Milk Tea, 50% sugar, less ice, with tapioca pearls" — never abbreviated. */
export function drinkText(dr: Drink): string {
  const milk = dr.milk ? `, made with ${ITEM_BY_ID[dr.milk].name}` : "";
  return `${cap(dr.size)} ${RECIPE_BY_ID[dr.recipeId].name}, ${dr.sugar}% sugar, ${ICE_TEXT[dr.ice]}, ${toppingText(dr.toppings)}${milk}`;
}

/** Full ticket readout including every drink. */
export function ticketText(t: Ticket): string {
  if (t.drinks.length === 1) return `Order ${t.id} for ${t.customer}: ${drinkText(t.drinks[0])}.`;
  const list = t.drinks.map((dr, i) => `drink ${i + 1}, ${drinkText(dr)}`).join("; ");
  return `Order ${t.id} for ${t.customer}, ${t.drinks.length} drinks: ${list}.`;
}

export const sizeText = (dr: Drink) => `${cap(dr.size)}, ${SIZE_ML[dr.size]} ml cup`;
