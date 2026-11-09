import { describe, expect, it } from "vitest";
import { mapSquareOrder } from "./squareMap";

const order = (line_items: object[], extra: object = {}) => ({ id: "SQ1", reference_id: "201", created_at: "2026-11-09T12:00:00Z", line_items, fulfillments: [{ pickup_details: { recipient: { display_name: "Ava" } } }], ...extra });

describe("mapSquareOrder", () => {
  it("maps name, size, sugar, ice, toppings, milk and customer", () => {
    const { ticket, warnings } = mapSquareOrder(order([{ name: "Taro Milk Tea", quantity: "1", modifiers: [{ name: "Large" }, { name: "50% sugar" }, { name: "Less ice" }, { name: "Tapioca pearls" }, { name: "Oat milk" }] }]), 900);
    expect(warnings).toEqual([]);
    expect(ticket).toMatchObject({ id: 201, customer: "Ava", squareOrderId: "SQ1", status: "pending" });
    expect(ticket!.drinks).toEqual([{ recipeId: "taro_milk_tea", size: "large", sugar: 50, ice: "less", toppings: ["tapioca"], milk: "oat_milk" }]);
  });

  it("expands quantity into separate drinks", () => {
    const { ticket } = mapSquareOrder(order([{ name: "Matcha Latte", quantity: "2", modifiers: [] }]), 900);
    expect(ticket!.drinks).toHaveLength(2);
    expect(ticket!.drinks[0].toppings).not.toBe(ticket!.drinks[1].toppings);
  });

  it("skips off-menu items and unknown modifiers with warnings, never guesses", () => {
    const { ticket, warnings } = mapSquareOrder(order([{ name: "Dragonfruit Slush" }, { name: "Thai Milk Tea", modifiers: [{ name: "Extra hug" }] }]), 900);
    expect(ticket!.drinks).toEqual([{ recipeId: "thai_milk_tea", size: "regular", sugar: 100, ice: "regular", toppings: [] }]);
    expect(warnings.join(" ")).toMatch(/Dragonfruit Slush.*not on the BobaJarvis menu/);
    expect(warnings.join(" ")).toMatch(/Unknown modifier "Extra hug"/);
  });

  it("returns no ticket when nothing maps, and falls back to a number without reference_id", () => {
    expect(mapSquareOrder(order([{ name: "Gift card" }]), 900).ticket).toBeNull();
    expect(mapSquareOrder(order([{ name: "Matcha Latte" }], { reference_id: undefined, fulfillments: [] }), 905).ticket).toMatchObject({ id: 905, customer: "Guest" });
  });
});
