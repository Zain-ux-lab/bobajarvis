// The executor owns every state transition. It is a pure function:
// (state, validated actions) -> (new state, spoken text). The LLM never edits state directly.
// A batch is atomic: we work on a copy, and if any action fails the original state is kept.

import type { Action } from "./actions";
import { evidenceInTranscript } from "./actions";
import { CATEGORIES, ITEM_BY_ID, ITEMS, LOW_STOCK_RATIO, formatQty, resolveItemId, toBaseUnit } from "./inventory";
import { RECIPE_BY_ID, STAGES, drinkLines, drinkRequirements, stageInstruction, syrupMl, type Drink } from "./recipes";
import { drinkText, pendingTickets, sizeText, ticketText, toppingText, type ShopState, type Ticket } from "./shop";

class ActionError extends Error {}
const fail = (msg: string): never => {
  throw new ActionError(msg);
};

export interface ExecResult {
  state: ShopState;
  speech: string;
  ok: boolean;
}

export function executePlan(original: ShopState, actions: Action[], transcript: string, reply = "", now = Date.now()): ExecResult {
  const s = structuredClone(original);
  const said: string[] = [];
  let completedThisTurn = false;
  // Reading or moving to a ticket/drink never starts its recipe, whatever the model adds to the plan.
  const navigates = actions.some((a) => a.type === "read_ticket" || a.type === "read_drink" || a.type === "next_drink" || a.type === "complete_ticket");

  try {
    for (const a of actions) {
      if (navigates && a.type === "continue_recipe") continue;
      // After a completion we already announced the next ticket; don't skip past it.
      if (completedThisTurn && a.type === "read_ticket" && a.target !== "specific") continue;
      if (a.type === "complete_ticket") {
        if (completedThisTurn) continue; // one completion per utterance, ever
        completedThisTurn = true;
      }
      const text = run(s, a, transcript, now);
      if (text) said.push(text);
    }
  } catch (e) {
    if (!(e instanceof ActionError)) throw e;
    const speech = `${e.message} Nothing was changed.`;
    return { state: withTurn(original, transcript, speech, actions, "rolled_back", now), speech, ok: false };
  }

  const warning = lowStockWarning(original.inventory, s.inventory);
  if (said.length === 0) said.push(reply.trim() || "Sorry, I didn't catch that.");
  if (warning) said.push(warning);
  const speech = said.join(" ");
  return { state: withTurn(s, transcript, speech, actions, "applied", now), speech, ok: true };
}

/** Record a turn (even a rejected one) in conversation memory and the action log. */
export function withTurn(s: ShopState, transcript: string, speech: string, actions: unknown[], result: ShopState["log"][number]["result"], now = Date.now()): ShopState {
  return {
    ...s,
    version: s.version + 1,
    turns: [...s.turns, { role: "user" as const, text: transcript }, { role: "assistant" as const, text: speech }].slice(-10),
    log: [{ at: now, transcript, actions, result, speech }, ...s.log].slice(0, 30),
  };
}

// ---------- helpers ----------

function findTicket(s: ShopState, id: number | undefined): Ticket {
  const ticketId = id ?? s.activeOrderId;
  if (ticketId == null) fail("There's no active ticket yet.");
  const t = s.tickets.find((x) => x.id === ticketId);
  if (!t) fail(`I can't find order ${ticketId}.`);
  return t!;
}

function activeDrink(s: ShopState): { t: Ticket; dr: Drink } {
  const t = findTicket(s, undefined);
  const dr = t.drinks[s.activeDrinkIndex];
  if (!dr) fail(`Order ${t.id} has no drink ${s.activeDrinkIndex + 1}.`);
  return { t, dr };
}

/** Select a ticket/drink. Selecting never starts or advances a recipe. */
function select(s: ShopState, t: Ticket, drinkIndex = 0) {
  if (s.activeOrderId !== t.id || s.activeDrinkIndex !== drinkIndex) s.currentRecipeStepIndex = -1;
  s.activeOrderId = t.id;
  s.activeDrinkIndex = drinkIndex;
}

function itemIdsOrFail(ids: string[]): string[] {
  return ids.map((raw) => resolveItemId(raw) ?? fail(`I don't track "${raw}" in inventory.`));
}

function stockLine(s: ShopState, id: string, now: number): string {
  const pct = Math.round((s.inventory[id] / ITEM_BY_ID[id].capacity) * 100);
  let line = `${ITEM_BY_ID[id].name} ${formatQty(id, s.inventory[id])} (${pct}%)`;
  if (id === "tapioca") line += `, batch cooked ${Math.round((now - s.tapiocaCookedAt) / 60_000)} minutes ago`;
  return line;
}

function lowStockWarning(before: Record<string, number>, after: Record<string, number>): string {
  const crossed = ITEMS.filter((i) => before[i.id] >= i.capacity * LOW_STOCK_RATIO && after[i.id] < i.capacity * LOW_STOCK_RATIO);
  if (crossed.length === 0) return "";
  return `Heads up: ${crossed.map((i) => `${i.name} is low, ${formatQty(i.id, after[i.id])} left`).join("; ")}.`;
}

// ---------- the action handlers ----------

function run(s: ShopState, a: Action, transcript: string, now: number): string {
  switch (a.type) {
    case "read_ticket": {
      const pending = pendingTickets(s);
      let t: Ticket | undefined;
      if (a.target === "specific") t = findTicket(s, a.orderId ?? fail("Which order number?"));
      else if (a.target === "first") t = pending[0];
      else if (a.target === "latest") t = pending.at(-1);
      else if (a.target === "current") t = pending.find((x) => x.id === s.activeOrderId) ?? pending[0];
      else {
        const cur = s.tickets.find((x) => x.id === s.activeOrderId);
        t = cur ? pending.find((x) => x.createdAt > cur.createdAt) : pending[0];
        if (!t) return cur ? `There are no pending tickets after order ${cur.id}.` : "There are no pending tickets.";
      }
      if (!t) return "There are no pending tickets.";
      // Re-reading the same ticket keeps the current step; a different ticket resets to "not started".
      if (t.id !== s.activeOrderId) select(s, t, 0);
      s.focus = "ticket";
      return t.status === "completed" ? `${ticketText(t)} That order is already completed.` : ticketText(t);
    }

    case "next_drink": {
      const t = findTicket(s, undefined);
      if (s.activeDrinkIndex + 1 < t.drinks.length) {
        select(s, t, s.activeDrinkIndex + 1);
        s.focus = "ticket";
        return `Drink ${s.activeDrinkIndex + 1} of ${t.drinks.length} on order ${t.id}: ${drinkText(t.drinks[s.activeDrinkIndex])}.`;
      }
      return run(s, { type: "read_ticket", target: "next" }, transcript, now);
    }

    case "read_drink": {
      const t = findTicket(s, a.orderId);
      if (a.drinkIndex > t.drinks.length) fail(`Order ${t.id} only has ${t.drinks.length} ${t.drinks.length === 1 ? "drink" : "drinks"}.`);
      select(s, t, a.drinkIndex - 1);
      s.focus = "ticket";
      return `Order ${t.id}, drink ${a.drinkIndex} of ${t.drinks.length}: ${drinkText(t.drinks[a.drinkIndex - 1])}.`;
    }

    case "count_queue": {
      if (a.recipeId && !RECIPE_BY_ID[a.recipeId]) fail(`I don't know the recipe "${a.recipeId}".`);
      const itemId = a.itemId ? (resolveItemId(a.itemId) ?? fail(`I don't track "${a.itemId}".`)) : undefined;
      const pending = pendingTickets(s);
      const matches = pending.flatMap((t) => t.drinks.map((dr) => ({ t, dr }))).filter(({ dr }) => (!a.recipeId || dr.recipeId === a.recipeId) && (!itemId || drinkRequirements(dr)[itemId] !== undefined));
      s.focus = "queue";
      const tickets = new Set(matches.map((m) => m.t.id));
      if (!a.recipeId && !itemId) return `${pending.length} pending ${pending.length === 1 ? "ticket" : "tickets"} with ${matches.length} ${matches.length === 1 ? "drink" : "drinks"}.`;
      const what = a.recipeId ? RECIPE_BY_ID[a.recipeId].name : ITEM_BY_ID[itemId!].name.replace(/ powder$/, "");
      if (matches.length === 0) return `No ${what} drinks are waiting.`;
      return `${matches.length} ${what} ${matches.length === 1 ? "drink is" : "drinks are"} waiting, on ${[...tickets].map((id) => `order ${id}`).join(" and ")}.`;
    }

    case "order_attribute": {
      const t = findTicket(s, a.orderId);
      const idx = (a.drinkIndex ?? (t.id === s.activeOrderId ? s.activeDrinkIndex + 1 : 1)) - 1;
      const dr = t.drinks[idx] ?? fail(`Order ${t.id} has no drink ${idx + 1}.`);
      const name = RECIPE_BY_ID[dr.recipeId].name;
      switch (a.attribute) {
        case "sugar": {
          const r = RECIPE_BY_ID[dr.recipeId];
          const ml = syrupMl(r, dr.size, dr.sugar);
          return ml > 0 ? `${dr.sugar}% sugar: ${ml} ml ${ITEM_BY_ID[r.sweetener].name}.` : `0% sugar, no syrup.`;
        }
        case "ice": {
          const grams = drinkLines(dr).find((l) => l.stage === 4)?.amount ?? 0;
          return dr.ice === "none" ? "No ice." : `${cap(dr.ice)} ice, ${grams} g.`;
        }
        case "toppings":
          return `${cap(toppingText(dr.toppings))}.`;
        case "size":
          return `${sizeText(dr)}.`;
        case "drink":
          return `${drinkText(dr)}.`;
        case "customer":
          return `Order ${t.id} is for ${t.customer}.`;
        case "milk": {
          const milks = Object.keys(drinkRequirements(dr)).filter((id) => ITEM_BY_ID[id].category === "milk");
          if (milks.length === 0) return `The ${name} has no milk.`;
          return `The ${name} uses ${milks.map((id) => ITEM_BY_ID[id].name).join(" and ")}${dr.milk ? ", substituted on the ticket" : ""}.`;
        }
      }
      return "";
    }

    case "continue_recipe": {
      const { t, dr } = activeDrink(s);
      if (t.status === "completed") return `Order ${t.id} is already complete. Ask for the next order when you're ready.`;
      s.focus = "recipe";
      if (s.currentRecipeStepIndex < STAGES.length - 1) {
        s.currentRecipeStepIndex += 1;
        const prefix = s.currentRecipeStepIndex === 0 ? `${cap(dr.size)} ${RECIPE_BY_ID[dr.recipeId].name}. ` : "";
        return prefix + stageInstruction(dr, s.currentRecipeStepIndex);
      }
      // Final stage: never auto-complete.
      if (s.activeDrinkIndex + 1 < t.drinks.length) {
        select(s, t, s.activeDrinkIndex + 1);
        return `That drink is finished. Next on order ${t.id}: drink ${s.activeDrinkIndex + 1}, ${drinkText(t.drinks[s.activeDrinkIndex])}. Say next to start it.`;
      }
      return `That was the last step. Is order ${t.id} ready to hand over?`;
    }

    case "read_stage": {
      const { dr } = activeDrink(s);
      const target = a.relation === "at" ? a.stage - 1 : a.relation === "after" ? a.stage : a.stage - 2;
      if (target < 0) fail("There's no step before step 1.");
      if (target >= STAGES.length) fail("Seal and serve is the last step.");
      s.currentRecipeStepIndex = target;
      s.focus = "recipe";
      return stageInstruction(dr, target);
    }

    case "complete_ticket": {
      // Grounding check repeated here so the executor is safe on its own.
      if (!evidenceInTranscript(a.completionEvidence, transcript)) fail("I wasn't sure you said the order is finished.");
      const t = findTicket(s, a.orderId);
      if (t.status === "completed" || t.deducted) return `Order ${t.id} was already completed.`;
      t.status = "completed";
      t.completedAt = now;
      // Deduct remaining requirements exactly once, minus anything already logged against this ticket.
      const total: Record<string, number> = {};
      for (const dr of t.drinks) for (const [id, amt] of Object.entries(drinkRequirements(dr))) total[id] = (total[id] ?? 0) + amt;
      for (const [id, amt] of Object.entries(total)) {
        const remaining = Math.max(0, amt - (t.credits[id] ?? 0));
        s.inventory[id] = Math.max(0, s.inventory[id] - remaining); // the drink exists; stock can't go negative
      }
      t.deducted = true;
      // Finishing some other ticket must not lose your place in the drink you're making.
      const active = s.tickets.find((x) => x.id === s.activeOrderId);
      if (active && active.id !== t.id && active.status === "pending") return `Order ${t.id} for ${t.customer} is complete.`;
      const next = pendingTickets(s)[0];
      if (!next) {
        s.activeOrderId = null;
        s.activeDrinkIndex = 0;
        s.currentRecipeStepIndex = -1;
        s.focus = "ticket";
        return `Order ${t.id} for ${t.customer} is complete. That was the last ticket.`;
      }
      s.activeOrderId = null; // force a fresh selection so the step resets
      select(s, next, 0);
      s.focus = "ticket";
      return `Order ${t.id} for ${t.customer} is complete. Next up: ${ticketText(next)}`;
    }

    case "query_inventory": {
      const known: string[] = [];
      const unknown: string[] = [];
      for (const raw of a.itemIds ?? []) {
        const id = resolveItemId(raw);
        if (id) known.push(id);
        else unknown.push(raw);
      }
      if (a.category) known.push(...ITEMS.filter((i) => i.category === a.category).map((i) => i.id));
      if (!a.itemIds?.length && !a.category) return `Which item or category? I track ${CATEGORIES.join(", ")}.`;
      const ids = [...new Set(known)];
      const parts: string[] = [];
      if (ids.length) {
        s.lastMentionedInventoryItems = ids;
        s.focus = "inventory";
        parts.push(`${cap(ids.map((id) => stockLine(s, id, now)).join("; "))}.`);
      }
      // Never invent numbers for something we don't track.
      if (unknown.length) parts.push(`I don't track ${unknown.join(" or ")}.`);
      return parts.join(" ");
    }

    case "adjust_inventory": {
      const ids = itemIdsOrFail(a.itemIds);
      const out: string[] = [];
      for (const id of ids) {
        const item = ITEM_BY_ID[id];
        if (a.mode === "replenish") {
          s.inventory[id] = item.capacity;
          if (id === "tapioca") s.tapiocaCookedAt = now;
          out.push(`${item.name} to ${formatQty(id, item.capacity)}`);
          continue;
        }
        if (a.amount === undefined || !a.unit) fail(`How much ${item.name}?`);
        const amt = toBaseUnit(id, a.amount!, a.unit!);
        if (amt === null) fail(`${a.unit} isn't a unit I can use for ${item.name}.`);
        if (a.mode === "use") {
          if (amt! > s.inventory[id]) fail(`There's only ${formatQty(id, s.inventory[id])} of ${item.name}.`);
          s.inventory[id] -= amt!;
          if (a.orderId !== undefined) {
            const t = findTicket(s, a.orderId);
            if (t.status === "pending") t.credits[id] = (t.credits[id] ?? 0) + amt!;
          }
          out.push(`used ${formatQty(id, amt!)} ${item.name}, ${formatQty(id, s.inventory[id])} left`);
        } else {
          s.inventory[id] += amt!;
          out.push(`added ${formatQty(id, amt!)} ${item.name}, now ${formatQty(id, s.inventory[id])}`);
        }
      }
      s.lastMentionedInventoryItems = ids;
      s.focus = "inventory";
      return a.mode === "replenish" ? `Restocked ${out.join(", ")}.` : `${cap(out.join("; "))}.`;
    }

    case "restock_mentioned": {
      if (s.lastMentionedInventoryItems.length === 0) return "Which items should I restock?";
      return run(s, { type: "adjust_inventory", mode: "replenish", itemIds: s.lastMentionedInventoryItems }, transcript, now);
    }

    case "clarify":
      return a.question;
  }
}

function cap(x: string) {
  return x.charAt(0).toUpperCase() + x.slice(1);
}
