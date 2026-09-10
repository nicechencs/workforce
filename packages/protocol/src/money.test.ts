import { describe, expect, it } from "vitest";

import { isUnknownCost, parseMoney, unknownCost } from "./money.js";

describe("money", () => {
  it("rejects non-integer minor units and major-unit aliases", () => {
    expect(() => parseMoney({ costMinor: 5, currency: "USD" })).not.toThrow();
    expect(() => parseMoney({ costMinor: 5.1, currency: "USD" })).toThrow();
    expect(() => parseMoney({ amount: 5.0, currency: "USD" })).toThrow();
  });

  it("does not treat unknown cost as an enforceable zero", () => {
    const money = unknownCost("USD");
    expect(money.costMinor).toBe(0);
    expect(isUnknownCost(money)).toBe(true);
  });
});
