import fs from "node:fs";

import { parseWorkflow, parseWorkflowPage, parseWorkflowVersion } from "@workforce/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { json, startTestDaemon, type TestDaemon } from "./helpers.js";

const FEATURE_DELIVERY_ID = "software-development-team.feature-delivery";

describe("workflow catalog HTTP", () => {
  const daemons: TestDaemon[] = [];

  afterEach(async () => {
    for (const item of daemons.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("lists published templates and returns version detail without inventing a Runtime", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;

    const listed = await json(daemon.port, "/api/v1/workflows", { headers: auth });
    expect(listed.status).toBe(200);
    const page = parseWorkflowPage(listed.body);
    expect(page.page.hasMore).toBe(false);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(FEATURE_DELIVERY_ID);
    expect(page.items[0]?.status).toBe("published");
    expect(page.items[0]?.versions[0]?.steps.map((step) => step.id)).toEqual([
      "planning",
      "implementation",
      "integration",
      "review",
      "acceptance",
    ]);

    const detail = await json(daemon.port, `/api/v1/workflows/${FEATURE_DELIVERY_ID}`, {
      headers: auth,
    });
    expect(detail.status).toBe(200);
    expect(parseWorkflow(detail.body).activeVersionId).toBe("0.1.0");

    const version = await json(
      daemon.port,
      `/api/v1/workflows/${FEATURE_DELIVERY_ID}/versions/0.1.0`,
      { headers: auth },
    );
    expect(version.status).toBe(200);
    const parsedVersion = parseWorkflowVersion(version.body);
    expect(parsedVersion.immutable).toBe(true);
    expect(parsedVersion.entry).toBe("planning");
    expect(JSON.stringify(version.body)).not.toMatch(/canvas|executableRuntime|codex exec/i);

    const missing = await json(daemon.port, "/api/v1/workflows/wf_missing", { headers: auth });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "not_found" });

    const missingVersion = await json(
      daemon.port,
      `/api/v1/workflows/${FEATURE_DELIVERY_ID}/versions/9.9.9`,
      { headers: auth },
    );
    expect(missingVersion.status).toBe(404);
  });
});
