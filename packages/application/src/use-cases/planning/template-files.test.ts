import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const templateRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../templates/software-development-team",
);

function read(rel: string): string {
  return readFileSync(resolve(templateRoot, rel), "utf8");
}

describe("software-development-team templates", () => {
  it("versions planner, developer, reviewer, policy, and workflow as published", () => {
    const files = [
      "template.yaml",
      "workers/planner.yaml",
      "workers/developer.yaml",
      "workers/reviewer.yaml",
      "policies/default.yaml",
      "workflows/feature-delivery.yaml",
      "evaluations/code-review.yaml",
    ];
    for (const file of files) {
      const body = read(file);
      expect(body, file).toMatch(/version:\s*"0\.1\.0"/);
      expect(body, file).toMatch(/status:\s*published/);
      expect(body, file).not.toMatch(/status:\s*placeholder/);
    }
  });

  it("binds workers to Mock Runtime and the default Policy", () => {
    for (const worker of ["planner", "developer", "reviewer"]) {
      const body = read(`workers/${worker}.yaml`);
      expect(body).toMatch(/adapterId:\s*mock/);
      expect(body).toMatch(/protocolVersion:\s*"0\.1"/);
      expect(body).toMatch(/policyRef:\s*software-development-team\.default@0\.1\.0/);
    }
    expect(read("workers/planner.yaml")).toMatch(/kind:\s*plan/);
    expect(read("workers/developer.yaml")).toMatch(/waitForReviewer:\s*false/);
    expect(read("workers/reviewer.yaml")).toMatch(/onUpstream:\s*outputs_ready/);
    expect(read("workers/reviewer.yaml")).toMatch(/requiresDeveloperCompleted:\s*false/);
  });

  it("denies automatic push and pull requests", () => {
    const policy = read("policies/default.yaml");
    expect(policy).toMatch(/action:\s*git\.push/);
    expect(policy).toMatch(/decision:\s*deny/);
    expect(policy).toMatch(/action:\s*git\.create_pull_request/);
    expect(policy).toMatch(/gate:\s*plan/);
    expect(policy).toMatch(/gate:\s*artifact/);
    const workflow = read("workflows/feature-delivery.yaml");
    expect(workflow).toMatch(/autoPush:\s*false/);
    expect(workflow).toMatch(/strategy:\s*stable_node_id_order/);
    expect(workflow).toMatch(/provision:\s*workspace\.provisionIntegrationWorkspace/);
    expect(workflow).toMatch(/apply:\s*workspace\.applyPatch/);
  });
});
