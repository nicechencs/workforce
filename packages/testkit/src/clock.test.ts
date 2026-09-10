import { describe, expect, it } from "vitest";

import { FakeClock } from "./clock.js";

describe("FakeClock", () => {
  it("is injectable and deterministic", () => {
    const clock = new FakeClock("2026-09-10T10:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-09-10T10:00:00.000Z");
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-09-10T10:00:01.500Z");
  });
});
