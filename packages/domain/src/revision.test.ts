import { describe, expect, it } from "vitest";

import { startIdempotencyKey } from "./revision.js";

describe("startIdempotencyKey", () => {
  it("scopes retry identity to content version, generation, and attempt", () => {
    expect(
      startIdempotencyKey({
        taskId: "tsk_1",
        definitionRevision: 1,
        generation: 2,
        attempt: 1,
      }),
    ).toBe("start:tsk_1:definitionRevision:1:generation:2:attempt:1");
  });
});
