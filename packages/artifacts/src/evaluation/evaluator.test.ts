import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { encodeUtf8 } from "../hash.js";
import { KIND_MEDIA_TYPES } from "../kinds.js";
import { LocalArtifactStore } from "../registration/local-artifact-store.js";
import { ArtifactEvaluator, type PolicyPort, type ProcessPort } from "./evaluator.js";

const roots: string[] = [];
const packageSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function harness(): Promise<{ store: LocalArtifactStore; evaluator: ArtifactEvaluator }> {
  const root = await mkdtemp(path.join(tmpdir(), "wf-t08-eval-"));
  roots.push(root);
  const store = await LocalArtifactStore.open({ root });
  let seq = 0;
  const evaluator = new ArtifactEvaluator({
    store,
    ids: { ulid: (prefix) => `${prefix}${++seq}` },
    clock: { now: () => new Date("2026-09-10T10:00:00.000Z") },
  });
  return { store, evaluator };
}

function planBody(title: string): Uint8Array {
  return encodeUtf8(JSON.stringify({ title, summary: "A plan." }));
}

function testResultBody(passed: boolean): Uint8Array {
  return encodeUtf8(JSON.stringify({ passed, summary: passed ? "ok" : "fail" }));
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") {
        continue;
      }
      out.push(...(await collectSourceFiles(full)));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("ArtifactEvaluator", () => {
  it("reports schema pass without completing a task", async () => {
    const { store, evaluator } = await harness();
    const plan = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("Ship auth"),
      kind: "plan",
      taskId: "tsk_eval",
    });

    const evaluation = await evaluator.evaluate({
      artifactVersionId: plan.artifactVersionId,
      criterion: { id: "ac_plan_schema", type: "schema" },
    });

    expect(evaluation.verdict).toBe("pass");
    expect(evaluation.artifactVersionId).toBe(plan.artifactVersionId);
    expect(evaluation).not.toHaveProperty("taskStatus");
    expect(evaluation).not.toHaveProperty("taskId");
    expect(Object.keys(evaluation).sort()).toEqual(
      [
        "artifactVersionId",
        "createdAt",
        "criterionId",
        "digest",
        "evidenceRefs",
        "id",
        "method",
        "scores",
        "summary",
        "verdict",
      ].sort(),
    );
  });

  it("uses test-result evidence bound to artifactVersionId", async () => {
    const { store, evaluator } = await harness();
    const diff = await store.register({
      slotId: "out_code_change",
      mediaType: KIND_MEDIA_TYPES.git_diff,
      body: encodeUtf8("diff --git a/a b/a\n--- a/a\n+++ b/a\n"),
      kind: "git_diff",
      metadata: { type: "git_diff", baseSha: "base" },
    });
    const evidence = await store.register({
      slotId: "out_test_result",
      mediaType: KIND_MEDIA_TYPES.test_result,
      body: testResultBody(true),
      kind: "test_result",
    });

    const evaluation = await evaluator.evaluate({
      artifactVersionId: diff.artifactVersionId,
      criterion: { id: "ac_tests", type: "test" },
      evidenceArtifactVersionIds: [evidence.artifactVersionId],
    });
    expect(evaluation.verdict).toBe("pass");
    expect(evaluation.evidenceRefs).toEqual([{ artifactVersionId: evidence.artifactVersionId }]);
  });

  it("does not inherit an old evaluation pass onto a new version", async () => {
    const { store, evaluator } = await harness();
    const v1 = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("v1"),
      kind: "plan",
    });
    const passed = await evaluator.evaluate({
      artifactVersionId: v1.artifactVersionId,
      criterion: { id: "ac_plan_schema", type: "schema" },
    });
    expect(passed.verdict).toBe("pass");

    const v2 = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("v2"),
      kind: "plan",
      artifactId: v1.artifactId,
    });
    expect(v2.version).toBe(2);
    expect(await store.listEvaluations(v2.artifactVersionId)).toEqual([]);
    expect(await store.listEvaluations(v1.artifactVersionId)).toHaveLength(1);

    const v2Eval = await evaluator.evaluate({
      artifactVersionId: v2.artifactVersionId,
      criterion: { id: "ac_plan_schema", type: "schema" },
    });
    expect(v2Eval.id).not.toBe(passed.id);
    expect(v2Eval.artifactVersionId).toBe(v2.artifactVersionId);
  });

  it("fails evaluation when the subject is quarantined", async () => {
    const { store, evaluator } = await harness();
    const plan = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("ok"),
      kind: "plan",
    });
    const blob = path.join(store.root, "blobs", plan.hash.slice(0, 2), plan.hash);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(blob, "nope");
    await store.verify(plan.artifactVersionId);

    const evaluation = await evaluator.evaluate({
      artifactVersionId: plan.artifactVersionId,
      criterion: { id: "ac_plan_schema", type: "schema" },
    });
    expect(evaluation.verdict).toBe("fail");
    expect(evaluation.summary).toMatch(/quarantined/i);
  });

  it("runs test commands only through Policy and Process ports", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wf-t08-ports-"));
    roots.push(root);
    const store = await LocalArtifactStore.open({ root });
    const plan = await store.register({
      slotId: "out_plan",
      mediaType: KIND_MEDIA_TYPES.plan,
      body: planBody("ports"),
      kind: "plan",
    });

    const noPorts = new ArtifactEvaluator({
      store,
      ids: { ulid: (prefix) => `${prefix}nop` },
      clock: { now: () => new Date("2026-09-10T10:00:00.000Z") },
    });
    await expect(
      noPorts.evaluate({
        artifactVersionId: plan.artifactVersionId,
        criterion: { id: "ac_tests", type: "test", commandRef: "test.default" },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_TEST_PORTS_REQUIRED" });

    const spawned: string[][] = [];
    const policy: PolicyPort = {
      async decide() {
        return { decision: "allow", policyVersion: "pol_1" };
      },
    };
    const processPort: ProcessPort = {
      async spawnCaptured(req) {
        spawned.push(req.argv);
        return {
          handle: { pid: 4242, startIdentity: "fake:4242" },
          output: (async function* () {})(),
          async wait() {
            return { exitCode: 0, signal: null };
          },
        };
      },
    };
    const withPorts = new ArtifactEvaluator({
      store,
      ids: { ulid: (prefix) => `${prefix}ports` },
      clock: { now: () => new Date("2026-09-10T10:00:00.000Z") },
      policy,
      process: processPort,
    });
    const evidence = await store.register({
      slotId: "out_test_result",
      mediaType: KIND_MEDIA_TYPES.test_result,
      body: testResultBody(true),
      kind: "test_result",
    });
    const evaluation = await withPorts.evaluate({
      artifactVersionId: plan.artifactVersionId,
      criterion: { id: "ac_tests", type: "test", commandRef: "test.default" },
      evidenceArtifactVersionIds: [evidence.artifactVersionId],
      command: { argv: ["node", "-e", "process.exit(0)"], cwd: root },
    });
    expect(evaluation.verdict).toBe("pass");
    expect(spawned).toEqual([["node", "-e", "process.exit(0)"]]);
  });

  it("does not import child_process or complete workflow tables", async () => {
    const files = await collectSourceFiles(packageSrc);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/child_process/);
      expect(source).not.toMatch(/workflow_instances|UPDATE\s+tasks|waiting_review/i);
    }
  });
});
