import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  orchestrationModes,
  parsePlacementSnapshot,
  parseRunExecutionSnapshot,
  placementIntentSchema,
  runtimeTransports,
} from "./execution.js";
import { parseStartRunRequest } from "./command.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtures, name), "utf8"));
}

const placement = {
  nodeId: "ndl_01JTESTLOCALNODE000000000",
  nodeSessionId: "nss_01JTESTNODESESSION000000",
  runtimeInstallationId: "rtm_01JTESTMOCKINSTALL000000",
  workspaceInstanceId: "wsi_01JTESTDEVA_WT0000000000",
  executionLeaseId: "lse_01JTESTEXECLEASE00000000",
  fencingToken: 1,
};

describe("execution axes", () => {
  it("freezes the transport enum to process | sdk | http", () => {
    expect([...runtimeTransports]).toEqual(["process", "sdk", "http"]);
  });

  it("freezes the orchestration mode enum and never uses executionMode", () => {
    expect([...orchestrationModes]).toEqual(["workflow_bound", "direct"]);
  });

  it("rejects remote as a transport (placement is a separate axis)", () => {
    expect(() => parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: "remote",
      placementSnapshot: placement,
    })).toThrow(/transport/);
  });
});

describe("run execution snapshot", () => {
  it("parses the workflow-bound fixture", () => {
    const parsed = parseRunExecutionSnapshot(fixture("run.execution.workflow-bound.json"));
    expect(parsed.orchestrationMode).toBe("workflow_bound");
    expect(parsed.executionSnapshotId).toMatch(/^snp_/);
    expect(parsed.placementSnapshot.fencingToken).toBe(1);
  });

  it("requires a project execution snapshot for workflow_bound", () => {
    expect(() => parseRunExecutionSnapshot({
      orchestrationMode: "workflow_bound",
      transport: "process",
      placementSnapshot: placement,
    })).toThrow(/executionSnapshotId/);
  });

  it("rejects the illegal direct-with-snapshot fixture", () => {
    expect(() => parseRunExecutionSnapshot(
      fixture("illegal.run.execution.direct-with-snapshot.json"),
    )).toThrow(/direct execution must not reference/);
  });

  it("accepts direct without a project execution snapshot", () => {
    const parsed = parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement,
    });
    expect(parsed.executionSnapshotId).toBeUndefined();
  });

  it("requires a resolved placement snapshot", () => {
    expect(() => parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: "sdk",
    })).toThrow();
  });

  it("marks a rebuilt placement snapshot as legacy", () => {
    const parsed = parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: { ...placement, legacySchemaVersion: "m3.legacy.1" },
    });
    expect(parsed.placementSnapshot.legacySchemaVersion).toBe("m3.legacy.1");
  });

  it("rejects the retired executionMode field name", () => {
    expect(() => parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement,
      executionMode: "bound",
    })).toThrow(/executionMode/);
  });
});

describe("placement", () => {
  it("parses a resolved placement snapshot", () => {
    expect(parsePlacementSnapshot(placement).workspaceInstanceId).toMatch(/^wsi_/);
  });

  it("accepts a placement intent that is not yet resolved", () => {
    const intent = placementIntentSchema.parse({ mode: "specific_node", nodeId: "ndl_x" });
    expect(intent.mode).toBe("specific_node");
  });

  it("rejects a resolved binding used as an intent", () => {
    expect(() => placementIntentSchema.parse(placement)).toThrow();
  });
});

describe("no regression on the frozen StartRunRequest", () => {
  it("still parses the M3 start-run command fixture with the same keys", () => {
    const command = parseStartRunRequest(fixture("command.run.start.json"));
    expect(Object.keys(command)).toEqual([
      "operationId",
      "idempotencyKey",
      "taskId",
      "definitionRevision",
      "generation",
      "attempt",
      "principalId",
      "clientId",
      "placement",
      "runtime",
      "snapshotRef",
    ]);
    expect(command.placement.executionNodeId).toMatch(/^ndl_/);
  });
});
