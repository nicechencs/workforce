import { describe, expect, it } from "vitest";

import { startRequestDigest } from "./digest.js";
import { createStartRunRequest } from "./request.js";

describe("startRequestDigest", () => {
  it("ignores operationId so the same payload hashes equal", () => {
    const a = createStartRunRequest({ operationId: "op_aaaa" });
    const b = createStartRunRequest({ operationId: "op_bbbb" });
    expect(startRequestDigest(a)).toBe(startRequestDigest(b));
  });

  it("changes when snapshotRef changes", () => {
    const a = createStartRunRequest({ snapshotRef: "mock:success" });
    const b = createStartRunRequest({ snapshotRef: "mock:failure" });
    expect(startRequestDigest(a)).not.toBe(startRequestDigest(b));
  });

  it("includes orchestrationMode so omit and explicit workflow_bound match, direct differs", () => {
    const omitted = createStartRunRequest();
    const bound = createStartRunRequest({ orchestrationMode: "workflow_bound" });
    const direct = createStartRunRequest({ orchestrationMode: "direct" });
    expect(omitted.orchestrationMode).toBe("workflow_bound");
    expect(startRequestDigest(omitted)).toBe(startRequestDigest(bound));
    expect(startRequestDigest(direct)).not.toBe(startRequestDigest(bound));
  });
});
