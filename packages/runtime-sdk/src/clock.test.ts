import { describe, expect, it } from "vitest";

import { ManualScheduler } from "./clock.js";

describe("ManualScheduler", () => {
  it("does not run work until time advances", async () => {
    const scheduler = new ManualScheduler();
    let ran = false;
    scheduler.schedule(1000, () => {
      ran = true;
    });
    await scheduler.flush();
    expect(ran).toBe(false);
    await scheduler.advance(1000);
    expect(ran).toBe(true);
    expect(scheduler.now().toISOString()).toBe("2026-09-10T10:00:01.000Z");
  });
});
