import { describe, expect, it } from "vitest";

import {
  parseProjectExecutionSnapshot,
  projectExecutionSnapshotHashFields,
} from "./execution-snapshot.js";

describe("project execution snapshot DTO", () => {
  it("parses the public snapshot without policy or budget payloads", () => {
    const parsed = parseProjectExecutionSnapshot({
      id: "snp_01JTESTEXECSNAPSHOT000000",
      projectId: "prj_1",
      workflowVersionId: "wfv_1",
      teamVersionId: "tmv_1",
      contentHash: "sha256:snp",
      immutable: true,
      createdAt: "2026-09-11T00:00:00.000Z",
    });
    expect(parsed.id).toMatch(/^snp_/);
    expect(parsed.immutable).toBe(true);
  });

  it("rejects policySnapshot on the public DTO", () => {
    expect(() =>
      parseProjectExecutionSnapshot({
        id: "snp_01JTESTEXECSNAPSHOT000000",
        projectId: "prj_1",
        workflowVersionId: "wfv_1",
        teamVersionId: "tmv_1",
        contentHash: "sha256:snp",
        immutable: true,
        createdAt: "2026-09-11T00:00:00.000Z",
        policySnapshot: { policyVersion: 1 },
      }),
    ).toThrow(/unrecognized_keys|policySnapshot/);
  });

  it("freezes the contentHash input field set", () => {
    expect([...projectExecutionSnapshotHashFields]).toEqual([
      "workflowVersionId",
      "teamVersionId",
      "policySnapshot",
      "budgetSnapshot",
    ]);
  });
});
