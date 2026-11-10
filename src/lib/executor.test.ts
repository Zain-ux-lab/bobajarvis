// These tests feed HAND-WRITTEN action plans to the executor. They prove the state
// machine and arithmetic, NOT that an LLM interprets natural language correctly.

import { describe, expect, it } from "vitest";
import type { Action } from "./actions";
import { executePlan } from "./executor";
import { ITEM_BY_ID } from "./inventory";
import { drinkLines, drinkRequirements, stageInstruction, syrupMl, RECIPE_BY_ID } from "./recipes";
import { initialState, type ShopState } from "./shop";

const run = (s: ShopState, actions: Action[], transcript = "test") => executePlan(s, actions, transcript, "", 1_000_000);
const go = (s: ShopState, actions: Action[], transcript?: string) => run(s, actions, transcript).state;

describe("recipe continuation", () => {
  it("never starts a recipe when the same plan reads a ticket (model added an extra action)", () => {
    const r = run(initialState(0), [{ type: "read_ticket", target: "first" }, { type: "continue_recipe" }], "What's the first order I have to make?");
    expect(r.state.currentRecipeStepIndex).toBe(-1);
    expect(r.speech).not.toContain("Step 1");
  });

  it("starts step 1 from a ready (not started) ticket", () => {
    const s0 = initialState(0);
    const r = run(s0, [{ type: "continue_recipe" }], "Got it. What's next?");
    expect(r.state.currentRecipeStepIndex).toBe(0);
    expect(r.speech).toContain("Step 1 of 7");
    expect(r.speech).toContain("Large Brown Sugar Boba Milk Tea");
  });

  it("advances exactly one stage from an intermediate stage", () => {
    let s = initialState(0);
    for (let i = 0; i < 3; i++) s = go(s, [{ type: "continue_recipe" }]);
    expect(s.currentRecipeStepIndex).toBe(2);
    const r = run(s, [{ type: "continue_recipe" }]);
    expect(r.state.currentRecipeStepIndex).toBe(3);
    expect(r.speech).toContain("Step 4 of 7");
    expect(r.state.activeOrderId).toBe(101);
  });

  it("at the final stage of a one-drink ticket asks to hand over, never completes", () => {
    let s = initialState(0);
    for (let i = 0; i < 7; i++) s = go(s, [{ type: "continue_recipe" }]);
    const inv = { ...s.inventory };
    const r = run(s, [{ type: "continue_recipe" }]);
    expect(r.speech).toMatch(/ready to hand over/);
    expect(r.state.tickets.find((t) => t.id === 101)!.status).toBe("pending");
    expect(r.state.inventory).toEqual(inv);
  });

  it("at the final stage of a multi-drink ticket moves to the next drink without starting it", () => {
    let s = go(initialState(0), [{ type: "read_ticket", target: "specific", orderId: 102 }]);
    for (let i = 0; i < 7; i++) s = go(s, [{ type: "continue_recipe" }]);
    const r = run(s, [{ type: "continue_recipe" }]);
    expect(r.state.activeDrinkIndex).toBe(1);
    expect(r.state.currentRecipeStepIndex).toBe(-1);
    expect(r.speech).toContain("Mango Green Tea");
  });

  it("'what comes after sugar' selects stage 4", () => {
    const r = run(initialState(0), [{ type: "read_stage", stage: 3, relation: "after" }]);
    expect(r.state.currentRecipeStepIndex).toBe(3);
    expect(r.speech).toContain("Step 4 of 7");
  });
});

describe("ticket requests", () => {
  it("never start or advance a recipe", () => {
    let s = initialState(0);
    s = go(s, [{ type: "continue_recipe" }, { type: "continue_recipe" }]);
    expect(s.currentRecipeStepIndex).toBe(1);
    s = go(s, [{ type: "read_ticket", target: "current" }]);
    expect(s.currentRecipeStepIndex).toBe(1); // same ticket: step kept, not advanced
    s = go(s, [{ type: "read_ticket", target: "next" }]);
    expect(s.activeOrderId).toBe(102);
    expect(s.currentRecipeStepIndex).toBe(-1); // new ticket: not started
    expect(s.tickets.find((t) => t.id === 101)!.status).toBe("pending"); // asking for next != completing
  });

  it("readouts include every modifier for every drink", () => {
    const r = run(initialState(0), [{ type: "read_ticket", target: "specific", orderId: 104 }]);
    expect(r.speech).toBe("Order 104 for Maya: Large Taro Milk Tea, 50% sugar, less ice, with tapioca pearls.");
    const multi = run(initialState(0), [{ type: "read_ticket", target: "specific", orderId: 102 }]).speech;
    expect(multi).toContain("2 drinks");
    expect(multi).toContain("Regular Matcha Latte, 50% sugar, regular ice, no toppings, made with oat milk");
    expect(multi).toContain("Large Mango Green Tea, 100% sugar, no ice, with popping boba and aloe vera");
  });

  it("next drink stays within the ticket, then moves to the next ticket", () => {
    let s = go(initialState(0), [{ type: "read_ticket", target: "specific", orderId: 102 }]);
    let r = run(s, [{ type: "next_drink" }]);
    expect(r.state.activeOrderId).toBe(102);
    expect(r.state.activeDrinkIndex).toBe(1);
    s = r.state;
    r = run(s, [{ type: "next_drink" }]);
    expect(r.state.activeOrderId).toBe(103);
    expect(r.state.activeDrinkIndex).toBe(0);
  });

  it("rejects an invalid drink index", () => {
    const r = run(initialState(0), [{ type: "read_drink", orderId: 104, drinkIndex: 3 }]);
    expect(r.ok).toBe(false);
    expect(r.speech).toMatch(/only has 1 drink/);
  });

  it("counts taro drinks across tickets, not grams", () => {
    const r = run(initialState(0), [{ type: "count_queue", itemId: "taro_powder" }]);
    expect(r.speech).toBe("2 taro drinks are waiting, on order 104 and order 105.");
  });
});

describe("completion", () => {
  it("completes, deducts exactly once, and announces the oldest pending ticket without starting it", () => {
    const s0 = initialState(0);
    const r = run(s0, [{ type: "complete_ticket", orderId: 101, completionEvidence: "order 101 is ready" }], "Order 101 is ready");
    expect(r.ok).toBe(true);
    const req = drinkRequirements(s0.tickets[0].drinks[0]);
    for (const [id, amt] of Object.entries(req)) expect(r.state.inventory[id]).toBe(s0.inventory[id] - amt);
    expect(r.state.activeOrderId).toBe(102);
    expect(r.state.currentRecipeStepIndex).toBe(-1);
    expect(r.speech).toContain("Order 101 for Jordan is complete. Next up: Order 102 for Priya");

    // Retried completion: no second deduction.
    const again = run(r.state, [{ type: "complete_ticket", orderId: 101, completionEvidence: "order 101 is ready" }], "Order 101 is ready");
    expect(again.state.inventory).toEqual(r.state.inventory);
    expect(again.speech).toMatch(/already completed/);
  });

  it("'that order is done, what's the next order' does not skip a ticket", () => {
    const r = run(initialState(0), [
      { type: "complete_ticket", completionEvidence: "that order is done" },
      { type: "read_ticket", target: "next" },
    ], "That order is done. What's the next order?");
    expect(r.state.activeOrderId).toBe(102);
    expect(r.state.tickets.filter((t) => t.status === "completed").map((t) => t.id)).toEqual([101]);
  });

  it("repeated completions in one utterance complete only one ticket", () => {
    const r = run(initialState(0), [
      { type: "complete_ticket", orderId: 101, completionEvidence: "done" },
      { type: "complete_ticket", orderId: 102, completionEvidence: "done" },
    ], "done done done");
    expect(r.state.tickets.filter((t) => t.status === "completed")).toHaveLength(1);
  });

  it("refuses a completion whose evidence is not in the transcript", () => {
    const r = run(initialState(0), [{ type: "complete_ticket", orderId: 101, completionEvidence: "order is ready" }], "Got it");
    expect(r.ok).toBe(false);
    expect(r.state.tickets[0].status).toBe("pending");
  });

  it("credits manual usage logged against a ticket instead of double-counting", () => {
    const s0 = initialState(0);
    const s1 = go(s0, [{ type: "adjust_inventory", mode: "use", itemIds: ["whole_milk"], amount: 100, unit: "ml", orderId: 101 }]);
    const s2 = go(s1, [{ type: "complete_ticket", orderId: 101, completionEvidence: "101 is finished" }], "101 is finished");
    const milk = drinkRequirements(s0.tickets[0].drinks[0]).whole_milk;
    expect(s2.inventory.whole_milk).toBe(s0.inventory.whole_milk - milk); // total, not total + 100
  });
});

describe("attribute questions", () => {
  it("sugar answer includes percentage and exact syrup", () => {
    const s = go(initialState(0), [{ type: "read_ticket", target: "specific", orderId: 104 }]);
    expect(run(s, [{ type: "order_attribute", attribute: "sugar" }]).speech).toBe("50% sugar: 18 ml cane sugar syrup.");
  });
  it("milk answer reflects substitutions", () => {
    const s = go(initialState(0), [{ type: "read_drink", orderId: 105, drinkIndex: 2 }]);
    expect(run(s, [{ type: "order_attribute", attribute: "milk" }]).speech).toContain("lactose-free milk");
  });
});

describe("ingredient arithmetic", () => {
  it("scales sugar by percentage and size", () => {
    const taro = RECIPE_BY_ID.taro_milk_tea; // 25 ml at regular 100%
    expect(syrupMl(taro, "regular", 100)).toBe(25);
    expect(syrupMl(taro, "regular", 50)).toBe(13);
    expect(syrupMl(taro, "large", 100)).toBe(35);
    expect(syrupMl(taro, "large", 70)).toBe(25);
    expect(syrupMl(taro, "large", 0)).toBe(0);
  });

  it("recipe instructions and deductions come from the same numbers", () => {
    const d = { recipeId: "taro_milk_tea", size: "large", sugar: 50, ice: "less", toppings: ["tapioca"] } as const;
    const lines = drinkLines({ ...d, toppings: [...d.toppings] });
    const milk = lines.find((l) => l.itemId === "whole_milk")!;
    expect(stageInstruction({ ...d, toppings: [...d.toppings] }, 0)).toContain(`${milk.amount} ml whole milk`);
    expect(drinkRequirements({ ...d, toppings: [...d.toppings] }).whole_milk).toBe(milk.amount);
  });

  it("fruit teas never get powder instructions", () => {
    const d = { recipeId: "mango_green_tea", size: "regular" as const, sugar: 100 as const, ice: "regular" as const, toppings: [] };
    const ids = Object.keys(drinkRequirements(d));
    expect(ids.some((id) => ITEM_BY_ID[id].category === "powder")).toBe(false);
  });
});

describe("inventory", () => {
  it("category query lists milk variants with quantities and remembers them", () => {
    const r = run(initialState(0), [{ type: "query_inventory", category: "milk" }]);
    expect(r.speech).toContain("oat milk 1.4 L");
    expect(r.state.lastMentionedInventoryItems).toContain("oat_milk");
  });

  it("'restock those' resolves the previously mentioned items", () => {
    const s = go(initialState(0), [{ type: "query_inventory", itemIds: ["oat"] }]);
    const r = run(s, [{ type: "restock_mentioned" }]);
    expect(r.state.inventory.oat_milk).toBe(ITEM_BY_ID.oat_milk.capacity);
  });

  it("'restock those' without a referent asks instead of guessing", () => {
    const r = run(initialState(0), [{ type: "restock_mentioned" }]);
    expect(r.speech).toBe("Which items should I restock?");
  });

  it("resolves mishearing aliases and never invents unknown items", () => {
    expect(run(initialState(0), [{ type: "query_inventory", itemIds: ["fruit to us"] }]).speech).toMatch(/fructose syrup 2000 ml/i);
    const u = run(initialState(0), [{ type: "query_inventory", itemIds: ["dragonfruit"] }]);
    expect(u.speech).toBe("I don't track dragonfruit.");
  });

  it("warns once, after the main reply, only when crossing below 15%", () => {
    const s = initialState(0); // pudding 7/40 = 17.5%
    const r = run(s, [{ type: "adjust_inventory", mode: "use", itemIds: ["pudding"], amount: 2, unit: "portions" }]);
    expect(r.speech).toBe("Used 2 portions egg pudding, 5 portions left. Heads up: egg pudding is low, 5 portions left.");
    const r2 = run(r.state, [{ type: "adjust_inventory", mode: "use", itemIds: ["pudding"], amount: 1, unit: "portions" }]);
    expect(r2.speech).not.toContain("Heads up"); // already below: no repeated warning
  });

  it("rolls back the whole batch if any action fails", () => {
    const s0 = initialState(0);
    const r = run(s0, [
      { type: "adjust_inventory", mode: "use", itemIds: ["whole_milk"], amount: 1, unit: "L" },
      { type: "adjust_inventory", mode: "use", itemIds: ["unicorn_dust"], amount: 1, unit: "g" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.state.inventory).toEqual(s0.inventory);
    expect(r.speech).toMatch(/Nothing was changed/);
  });

  it("rejects incompatible units and over-usage", () => {
    expect(run(initialState(0), [{ type: "adjust_inventory", mode: "use", itemIds: ["taro_powder"], amount: 1, unit: "L" }]).ok).toBe(false);
    expect(run(initialState(0), [{ type: "adjust_inventory", mode: "use", itemIds: ["pudding"], amount: 99, unit: "portions" }]).ok).toBe(false);
  });
});
