import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decodeSseCursor, encodeSseCursor, parseWorkforceEvent } from "./event.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("WorkforceEvent", () => {
  it("accepts the canonical task.completed fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "event.task.completed.json"), "utf8"),
    );
    const event = parseWorkforceEvent(raw);
    expect(event.specVersion).toBe("0.1");
    expect(event.type).toBe("task.completed");
    expect(event.data["to"]).toBe("completed");
  });

  it("rejects the obsolete payload/occurredAt envelope", () => {
    expect(() =>
      parseWorkforceEvent({
        schemaVersion: "0.1",
        occurredAt: "2026-09-10T10:00:00.000Z",
        payload: {},
      }),
    ).toThrow();
  });

  it("round-trips an opaque SSE cursor bound to a filter", () => {
    const encoded = encodeSseCursor({ ingestionPosition: 40, filterDigest: "project:prj_1" });
    expect(decodeSseCursor(encoded)).toEqual({
      ingestionPosition: 40,
      filterDigest: "project:prj_1",
    });
  });
});
