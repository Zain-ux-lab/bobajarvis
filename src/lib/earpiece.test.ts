import { describe, expect, it } from "vitest";
import { spoken } from "./earpiece";

describe("spoken units", () => {
  it("says units as words, only after a number", () => {
    expect(spoken("Whole milk 8 L (67%); oat milk 1.4 L; pour 350 ml; 1 L left; 120 g taro; 1 kg")).toBe("Whole milk 8 litres (67%); oat milk 1.4 litres; pour 350 millilitres; 1 litre left; 120 grams taro; 1 kilogram");
    expect(spoken("Large 700 ml cup. L is fine.")).toBe("Large 700 millilitres cup. L is fine.");
  });
});
