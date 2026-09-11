import { describe, expect, it } from "vitest";

import { parseProjectDto, parseRunDto, parseTeamDto } from "./dto.js";

describe("public HTTP DTOs", () => {
  it("parses the current M3 ProjectDto without an execution snapshot", () => {
    const parsed = parseProjectDto({
      id: "prj_1",
      organizationId: "org_1",
      name: "N",
      objective: "O",
      status: "draft",
      stateRevision: 1,
      protocolVersion: "0.1",
      cancelRequested: false,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(parsed.executionSnapshotId).toBeUndefined();
  });

  it("accepts optional executionSnapshotId on ProjectDto", () => {
    const parsed = parseProjectDto({
      id: "prj_1",
      organizationId: "org_1",
      name: "N",
      objective: "O",
      status: "ready",
      stateRevision: 2,
      protocolVersion: "0.1",
      cancelRequested: false,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      executionSnapshotId: "snp_01JTESTEXECSNAPSHOT000000",
    });
    expect(parsed.executionSnapshotId).toMatch(/^snp_/);
  });

  it("parses the current M3 RunDto without fake axis defaults", () => {
    const parsed = parseRunDto({
      id: "run_1",
      taskId: "tsk_1",
      projectId: "prj_1",
      status: "running",
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      protocolVersion: "0.1",
      cancelRequested: false,
      usage: { costMinor: 0, currency: "USD", kind: "unknown" },
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(parsed.orchestrationMode).toBeUndefined();
    expect(parsed.transport).toBeUndefined();
    expect(parsed.executionSnapshotId).toBeUndefined();
  });

  it("rejects a retired executionMode key on RunDto", () => {
    expect(() =>
      parseRunDto({
        id: "run_1",
        taskId: "tsk_1",
        projectId: "prj_1",
        status: "running",
        stateRevision: 1,
        definitionRevision: 1,
        generation: 1,
        attempt: 1,
        protocolVersion: "0.1",
        cancelRequested: false,
        usage: { costMinor: 0, currency: "USD", kind: "unknown" },
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
        executionMode: "remote",
      }),
    ).toThrow(/executionMode|unrecognized_keys/);
  });

  it("parses a published TeamDto", () => {
    const parsed = parseTeamDto({
      id: "software-development-team",
      name: "Software Development",
      version: "1",
      status: "published",
      protocolVersion: "0.1",
      roles: [{ id: "developer", role: "developer", version: "1" }],
    });
    expect(parsed.roles).toHaveLength(1);
  });
});
