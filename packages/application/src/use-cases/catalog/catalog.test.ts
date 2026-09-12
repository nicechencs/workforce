import { describe, expect, it } from "vitest";
import { validateWorkflowGraph } from "@workforce/workflow-engine";

import { MemoryIds } from "../projects/store.js";
import { UseCaseError } from "../projects/errors.js";
import { CatalogService } from "./service.js";
import { MemoryCatalog } from "./store.js";
import { isBindableTeamVersion, isExecutableWorkflowVersion } from "./executable.js";

function service(): CatalogService {
  return new CatalogService({
    catalog: new MemoryCatalog(),
    ids: new MemoryIds(),
    now: () => "2026-09-11T12:00:00.000Z",
    validateWorkflowGraph,
  });
}

const linearGraph = {
  entry: "plan",
  nodes: [
    { id: "plan", kind: "task" as const, role: "planner" as const, title: "Plan" },
    { id: "build", kind: "task" as const, role: "developer" as const, title: "Build" },
  ],
  edges: [{ id: "e1", from: "plan", to: "build", waitFor: "outputs_ready" as const }],
};

describe("catalog write use-cases", () => {
  it("saves a draft graph and only lists it after publish", () => {
    const catalog = service();
    const workflow = catalog.createWorkflow({ name: "Custom", description: "proj" });
    expect(workflow.status).toBe("draft");
    expect(catalog.listPublishedWorkflows()).toEqual([]);

    const version = catalog.createWorkflowVersion(workflow.id, linearGraph);
    expect(version.status).toBe("draft");
    expect(isExecutableWorkflowVersion(version)).toBe(false);
    expect(() => catalog.assertExecutableWorkflowVersion(workflow.id, version.id)).toThrow(
      UseCaseError,
    );

    const published = catalog.publishWorkflowVersion(workflow.id, version.id);
    expect(published.status).toBe("published");
    expect(published.immutable).toBe(true);
    expect(isExecutableWorkflowVersion(published)).toBe(true);
    expect(catalog.assertExecutableWorkflowVersion(workflow.id, version.id).id).toBe(version.id);
    expect(catalog.listPublishedWorkflows().map((item) => item.id)).toEqual([workflow.id]);
    expect(catalog.getWorkflow(workflow.id)?.status).toBe("published");
  });

  it("rejects cycles on publish and refuses to mutate a published version", () => {
    const catalog = service();
    const workflow = catalog.createWorkflow({ name: "Cyclic" });
    const version = catalog.createWorkflowVersion(workflow.id, {
      entry: "a",
      nodes: [
        { id: "a", kind: "task", role: "developer" },
        { id: "b", kind: "task", role: "developer" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "ba", from: "b", to: "a" },
      ],
    });
    expect(() => catalog.publishWorkflowVersion(workflow.id, version.id)).toThrow(
      /cycle|circular/i,
    );

    const ok = catalog.createWorkflowVersion(workflow.id, linearGraph);
    catalog.publishWorkflowVersion(workflow.id, ok.id);
    expect(() => catalog.patchWorkflowVersion(workflow.id, ok.id, { entry: "build" })).toThrow(
      UseCaseError,
    );
    expect(() => catalog.patchWorkflow(workflow.id, { name: "Nope" })).toThrow(UseCaseError);
  });

  it("publishes a TeamVersion and refuses unpublished start-planning binds", () => {
    const catalog = service();
    const team = catalog.createTeam({ name: "Squad" });
    const draft = catalog.createTeamVersion(team.id, {
      members: [{ role: "developer", runtimeProfileId: "mock", quantity: 1 }],
    });
    expect(isBindableTeamVersion(draft)).toBe(false);
    expect(() => catalog.assertBindableTeamVersion(draft.id)).toThrow(/unpublished/i);
    expect(catalog.listPublishedTeams()).toEqual([]);

    const published = catalog.publishTeamVersion(team.id, draft.id);
    expect(isBindableTeamVersion(published)).toBe(true);
    expect(catalog.assertBindableTeamVersion(published.id).immutable).toBe(true);
    expect(catalog.listPublishedTeams().map((item) => item.id)).toEqual([team.id]);
    expect(() =>
      catalog.patchTeamVersion(team.id, published.id, {
        members: [{ role: "reviewer", runtimeProfileId: "mock", quantity: 1 }],
      }),
    ).toThrow(UseCaseError);
  });
});
