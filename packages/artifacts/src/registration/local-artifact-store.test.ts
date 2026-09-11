import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactError } from "../errors.js";
import { collectBytes, encodeUtf8, sha256Hex } from "../hash.js";
import { KIND_MEDIA_TYPES } from "../kinds.js";
import { LocalArtifactStore } from "./local-artifact-store.js";

const roots: string[] = [];

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function openStore(): Promise<LocalArtifactStore> {
  const root = await mkdtemp(path.join(tmpdir(), "wf-t08-"));
  roots.push(root);
  return LocalArtifactStore.open({ root });
}

function planBody(title = "Auth plan"): Uint8Array {
  return encodeUtf8(
    JSON.stringify({
      title,
      summary: "Implement email/password authentication.",
      steps: ["design", "implement", "test"],
    }),
  );
}

function testResultBody(passed: boolean): Uint8Array {
  return encodeUtf8(
    JSON.stringify({
      passed,
      command: "test.default",
      summary: passed ? "all tests passed" : "1 failed",
    }),
  );
}

function gitDiffBody(): Uint8Array {
  return encodeUtf8(`diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -0,0 +1,3 @@
+export function login(): void {
+}
`);
}

describe("LocalArtifactStore", () => {
  it("registers plan, git_diff, and test_result through staging verify available", async () => {
    const store = await openStore();

    const plan = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody(),
      kind: "plan",
      taskId: "tsk_1",
      runId: "run_1",
      name: "Implementation plan",
    });
    const diff = await store.register({
      slotId: "out_code_change",
      mediaType: KIND_MEDIA_TYPES.git_diff,
      body: gitDiffBody(),
      kind: "git_diff",
      taskId: "tsk_1",
      runId: "run_1",
      schema: { type: "git_diff", baseRef: "immutable-base" },
      metadata: { type: "git_diff", baseSha: "9f13b5e8deadbeef", changedPaths: ["src/auth.ts"] },
    });
    const tests = await store.register({
      slotId: "out_test_result",
      mediaType: KIND_MEDIA_TYPES.test_result,
      body: testResultBody(true),
      kind: "test_result",
      taskId: "tsk_1",
      runId: "run_1",
    });
    const review = await store.register({
      slotId: "out_review_report",
      mediaType: KIND_MEDIA_TYPES.evaluation,
      body: encodeUtf8(JSON.stringify({ verdict: "pass", summary: "looks good" })),
      kind: "evaluation",
      taskId: "tsk_1",
      runId: "run_1",
    });
    const publishedPlan = await store.register({
      slotId: "plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: encodeUtf8(
        JSON.stringify({
          protocol: "workforce.plan",
          protocolVersion: "0.1",
          workflowId: "software-development-team.feature-delivery",
          objective: "Deliver a two-slice mock feature on a frozen baseline.",
        }),
      ),
      kind: "plan",
    });

    expect(plan.status).toBe("available");
    expect(diff.status).toBe("available");
    expect(tests.status).toBe("available");
    expect(review.status).toBe("available");
    expect(review.kind).toBe("evaluation");
    expect(publishedPlan.status).toBe("available");
    expect(publishedPlan.kind).toBe("plan");
    expect(plan.version).toBe(1);
    expect(diff.kind).toBe("git_diff");
    expect(tests.kind).toBe("test_result");

    const planBytes = await collectBytes(store.read(plan.artifactVersionId));
    expect(sha256Hex(planBytes)).toBe(plan.hash);
    expect(planBytes.byteLength).toBe(plan.size);

    const ready = await store.acceptanceReady({
      taskId: "tsk_1",
      requiredSlotIds: ["out_plan", "out_code_change", "out_test_result"],
    });
    expect(ready.ready).toBe(true);
    expect(ready.missing).toEqual([]);
    expect(ready.quarantined).toEqual([]);
  });

  it("keeps ArtifactVersion immutable once available", async () => {
    const store = await openStore();
    const first = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("v1"),
      kind: "plan",
    });
    const second = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("v2"),
      kind: "plan",
      artifactId: first.artifactId,
    });

    expect(second.artifactVersionId).not.toBe(first.artifactVersionId);
    expect(second.version).toBe(2);
    expect(second.hash).not.toBe(first.hash);
    expect((await store.getStored(first.artifactVersionId)).hash).toBe(first.hash);
    expect((await store.getStored(first.artifactVersionId)).status).toBe("available");
    expect(second.supersedes).toEqual({ artifactId: first.artifactId, version: 1 });
  });

  it("requires artifactVersionId for read, approval, and input; latest is browse-only", async () => {
    const store = await openStore();
    const version = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody(),
      kind: "plan",
    });

    await expect(
      store.resolveForUse({ artifactId: version.artifactId, latest: true }, "read"),
    ).rejects.toMatchObject({ code: "ARTIFACT_VERSION_REQUIRED" });
    await expect(
      store.resolveForUse({ artifactId: version.artifactId, latest: true }, "approval"),
    ).rejects.toMatchObject({ code: "ARTIFACT_VERSION_REQUIRED" });
    await expect(
      store.resolveForUse({ artifactId: version.artifactId, latest: true }, "input"),
    ).rejects.toMatchObject({ code: "ARTIFACT_VERSION_REQUIRED" });

    const browsed = await store.resolveForUse(
      { artifactId: version.artifactId, latest: true },
      "browse",
    );
    expect(browsed.artifactVersionId).toBe(version.artifactVersionId);
    const exact = await store.resolveForUse(
      { artifactVersionId: version.artifactVersionId },
      "input",
    );
    expect(exact.artifactVersionId).toBe(version.artifactVersionId);
    const byNumber = await store.resolveForUse(
      { artifactId: version.artifactId, version: 1 },
      "approval",
    );
    expect(byNumber.artifactVersionId).toBe(version.artifactVersionId);
  });

  it("quarantines tampered content and refuses acceptance", async () => {
    const store = await openStore();
    const version = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody(),
      kind: "plan",
      taskId: "tsk_q",
    });
    const blob = path.join(store.root, "blobs", version.hash.slice(0, 2), version.hash);
    await writeFile(blob, "tampered-bytes");

    const verified = await store.verify(version.artifactVersionId);
    expect(verified.status).toBe("quarantined");
    await expect(collectBytes(store.read(version.artifactVersionId))).rejects.toMatchObject({
      code: "ARTIFACT_QUARANTINED",
    });

    const ready = await store.acceptanceReady({
      taskId: "tsk_q",
      requiredSlotIds: ["out_plan"],
    });
    expect(ready.ready).toBe(false);
    expect(ready.quarantined).toEqual(["out_plan"]);
  });

  it("does not promote crash-window staging to available and commit is idempotent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-t08-crash-"));
    roots.push(root);
    const store = await LocalArtifactStore.open({ root });
    const staging = await store.stage({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody(),
      kind: "plan",
    });
    const metaOnDisk = await readFile(
      path.join(root, "staging", staging.stagingId, "meta.json"),
      "utf8",
    );
    expect(metaOnDisk.length).toBeGreaterThan(0);
    expect(await store.listAvailable()).toHaveLength(0);

    const recovered = await LocalArtifactStore.open({ root });
    const reconcile = await recovered.reconcile();
    expect(reconcile.availableCount).toBe(0);
    expect(reconcile.stagingLeft).toBe(1);

    const first = await recovered.commit(staging);
    expect(first.status).toBe("available");
    const second = await recovered.commit(staging);
    expect(second.artifactVersionId).toBe(first.artifactVersionId);

    const again = await LocalArtifactStore.open({ root });
    expect(await again.listAvailable()).toHaveLength(1);
    const third = await again.commit(staging);
    expect(third.artifactVersionId).toBe(first.artifactVersionId);
  });

  it("rejects invalid schema and does not create an available version", async () => {
    const store = await openStore();
    const staging = await store.stage({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: encodeUtf8(JSON.stringify({ title: "missing summary" })),
      kind: "plan",
    });
    await expect(store.commit(staging)).rejects.toMatchObject({ code: "ARTIFACT_SCHEMA_INVALID" });
    expect(await store.listAvailable()).toHaveLength(0);
  });

  it("records exact-version lineage and rejects cycles", async () => {
    const store = await openStore();
    const plan = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody(),
      kind: "plan",
    });
    const diff = await store.register({
      slotId: "out_code_change",
      mediaType: KIND_MEDIA_TYPES.git_diff,
      body: gitDiffBody(),
      kind: "git_diff",
      metadata: { type: "git_diff", baseSha: "abc123" },
      sources: [{ artifactVersionId: plan.artifactVersionId, relation: "derived_from" }],
    });
    expect(await store.lineageOf(diff.artifactVersionId)).toEqual([
      { artifactVersionId: plan.artifactVersionId, relation: "derived_from" },
    ]);

    const next = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("v2"),
      kind: "plan",
      artifactId: plan.artifactId,
      sources: [{ artifactVersionId: diff.artifactVersionId, relation: "derived_from" }],
    });
    expect(next.version).toBe(2);
    expect(await store.lineageOf(next.artifactVersionId)).toEqual([
      { artifactVersionId: diff.artifactVersionId, relation: "derived_from" },
    ]);

    await expect(
      store.register({
        slotId: "out_code_change",
        mediaType: KIND_MEDIA_TYPES.git_diff,
        body: gitDiffBody(),
        kind: "git_diff",
        metadata: { type: "git_diff", baseSha: "abc123" },
        sources: [{ artifactVersionId: "arv_missing", relation: "derived_from" }],
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("does not bind quarantined integrity failures as required outputs", async () => {
    const store = await openStore();
    const body = planBody();
    const staging = await store.stage({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body,
      kind: "plan",
      taskId: "tsk_bad",
      expectedHash: "0".repeat(64),
    });
    await expect(store.commit(staging)).rejects.toBeInstanceOf(ArtifactError);
    const ready = await store.acceptanceReady({
      taskId: "tsk_bad",
      requiredSlotIds: ["out_plan"],
    });
    expect(ready.ready).toBe(false);
    expect(ready.missing).toEqual(["out_plan"]);
  });
});
