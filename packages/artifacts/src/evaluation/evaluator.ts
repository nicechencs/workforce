import { ProcessControllerError, type ProcessController } from "@workforce/process";

import { ArtifactError, isArtifactError } from "../errors.js";
import { collectBytes, sha256Hex } from "../hash.js";
import { parseTestResultPassed, verifyKindContent } from "../kinds.js";
import type { LocalArtifactStore } from "../registration/local-artifact-store.js";
import type { EvaluationRecord } from "../types.js";
import {
  commandCriterionPassed,
  describeProcessExit,
  isProcessControllerError,
  waitCapturedExit,
} from "./command.js";

export interface PolicyDecision {
  decision: "allow" | "deny" | "require_approval";
  policyVersion: string;
  reason?: string;
}

export interface PolicyPort {
  decide(action: {
    type: string;
    digest: string;
    resource: string;
    version?: string;
  }): Promise<PolicyDecision>;
}

/** Injected ProcessController surface used for command criteria. Inspect is not an exit port. */
export type ProcessPort = Pick<ProcessController, "spawnCaptured">;

export interface EvaluateCriterion {
  id: string;
  type: "schema" | "test";
  commandRef?: string;
  schemaRef?: string;
}

export interface EvaluateInput {
  artifactVersionId: string;
  criterion: EvaluateCriterion;
  schema?: Record<string, unknown>;
  evidenceArtifactVersionIds?: string[];
  command?: { argv: string[]; cwd: string };
}

export interface EvaluatorOptions {
  store: LocalArtifactStore;
  ids: { ulid(prefix: string): string };
  clock: { now(): Date };
  policy?: PolicyPort;
  process?: ProcessPort;
}

/**
 * Reports schema/test verdicts for a precise ArtifactVersion.
 * Does not transition Task/Run/Workflow state (T09).
 */
export class ArtifactEvaluator {
  private readonly store: LocalArtifactStore;
  private readonly ids: EvaluatorOptions["ids"];
  private readonly clock: EvaluatorOptions["clock"];
  private readonly policy: PolicyPort | undefined;
  private readonly process: ProcessPort | undefined;

  constructor(options: EvaluatorOptions) {
    this.store = options.store;
    this.ids = options.ids;
    this.clock = options.clock;
    this.policy = options.policy;
    this.process = options.process;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluationRecord> {
    try {
      const stored = await this.store.getStored(input.artifactVersionId);
      if (stored.status === "quarantined") {
        return this.persist({
          artifactVersionId: stored.artifactVersionId,
          digest: stored.hash,
          method: input.criterion.type,
          criterionId: input.criterion.id,
          verdict: "fail",
          summary: "subject is quarantined and cannot be accepted",
          evidenceRefs: (input.evidenceArtifactVersionIds ?? []).map((id) => ({
            artifactVersionId: id,
          })),
          scores: { acceptance: 0 },
        });
      }
      if (stored.contentPurged === true) {
        return this.persist({
          artifactVersionId: stored.artifactVersionId,
          digest: stored.hash,
          method: input.criterion.type,
          criterionId: input.criterion.id,
          verdict: "fail",
          summary:
            stored.contentSummary ??
            "subject original content was retained and cannot be evaluated",
          evidenceRefs: [],
          scores: { acceptance: 0 },
        });
      }
      if (stored.status !== "available" && stored.status !== "archived") {
        return this.persist({
          artifactVersionId: stored.artifactVersionId,
          digest: stored.hash,
          method: input.criterion.type,
          criterionId: input.criterion.id,
          verdict: "fail",
          summary: `subject status ${stored.status} cannot be evaluated`,
          evidenceRefs: [],
          scores: { acceptance: 0 },
        });
      }

      if (input.criterion.type === "schema") {
        return this.evaluateSchema(stored.artifactVersionId, stored.hash, input);
      }
      return this.evaluateTest(stored.artifactVersionId, stored.hash, input);
    } catch (error) {
      if (isArtifactError(error) && isIntegrityFailure(error.code)) {
        const stored = await this.store.getStored(input.artifactVersionId).catch(() => undefined);
        return this.persist({
          artifactVersionId: input.artifactVersionId,
          ...(stored !== undefined ? { digest: stored.hash } : {}),
          method: input.criterion.type,
          criterionId: input.criterion.id,
          verdict: "fail",
          summary: error.message,
          evidenceRefs: [],
          scores: { acceptance: 0 },
        });
      }
      throw error;
    }
  }

  private async evaluateSchema(
    artifactVersionId: string,
    digest: string,
    input: EvaluateInput,
  ): Promise<EvaluationRecord> {
    const stored = await this.store.getStored(artifactVersionId);
    const body = await collectBytes(this.store.read(artifactVersionId));
    try {
      verifyKindContent({
        kind: stored.kind,
        body,
        ...(stored.metadata !== undefined ? { metadata: stored.metadata } : {}),
        ...(input.schema !== undefined
          ? { schema: input.schema }
          : stored.schema !== undefined
            ? { schema: stored.schema }
            : {}),
      });
      return this.persist({
        artifactVersionId,
        digest,
        method: "schema",
        criterionId: input.criterion.id,
        verdict: "pass",
        summary: "schema verification passed",
        evidenceRefs: [{ artifactVersionId }],
        scores: { schema: 1 },
      });
    } catch (error) {
      const summary = error instanceof ArtifactError ? error.message : "schema verification failed";
      return this.persist({
        artifactVersionId,
        digest,
        method: "schema",
        criterionId: input.criterion.id,
        verdict: "fail",
        summary,
        evidenceRefs: [{ artifactVersionId }],
        scores: { schema: 0 },
      });
    }
  }

  private async evaluateTest(
    artifactVersionId: string,
    digest: string,
    input: EvaluateInput,
  ): Promise<EvaluationRecord> {
    if (input.criterion.commandRef !== undefined) {
      return this.runTestCommand(artifactVersionId, digest, input);
    }

    return this.evaluateTestEvidence(artifactVersionId, digest, input);
  }

  private async evaluateTestEvidence(
    artifactVersionId: string,
    digest: string,
    input: EvaluateInput,
    extraSummary?: string,
  ): Promise<EvaluationRecord> {
    const evidenceIds = input.evidenceArtifactVersionIds ?? [];
    if (evidenceIds.length === 0) {
      if (extraSummary !== undefined) {
        return this.persist({
          artifactVersionId,
          digest,
          method: "test",
          criterionId: input.criterion.id,
          verdict: "pass",
          summary: extraSummary,
          evidenceRefs: [],
          scores: { tests: 1 },
        });
      }
      return this.persist({
        artifactVersionId,
        digest,
        method: "test",
        criterionId: input.criterion.id,
        verdict: "inconclusive",
        summary: "test criterion has no evidence artifactVersionId",
        evidenceRefs: [],
        scores: { tests: 0 },
      });
    }

    const evidenceRefs: Array<{ artifactVersionId: string }> = [];
    let passed = true;
    const summaries: string[] = [];
    if (extraSummary !== undefined) {
      summaries.push(extraSummary);
    }
    for (const evidenceId of evidenceIds) {
      const evidence = await this.store.getStored(evidenceId);
      evidenceRefs.push({ artifactVersionId: evidenceId });
      if (evidence.status === "quarantined") {
        passed = false;
        summaries.push(`${evidenceId} quarantined`);
        continue;
      }
      if (evidence.contentPurged === true) {
        passed = false;
        summaries.push(`${evidenceId} original content retained`);
        continue;
      }
      if (evidence.kind !== "test_result") {
        passed = false;
        summaries.push(`${evidenceId} is ${evidence.kind}, not test_result`);
        continue;
      }
      const body = await collectBytes(this.store.read(evidenceId));
      const resultPassed = parseTestResultPassed(body);
      if (!resultPassed) {
        passed = false;
        summaries.push(`${evidenceId} reported failed tests`);
      }
    }

    return this.persist({
      artifactVersionId,
      digest,
      method: "test",
      criterionId: input.criterion.id,
      verdict: passed ? "pass" : "fail",
      summary: passed ? (extraSummary ?? "test evidence passed") : summaries.join("; "),
      evidenceRefs,
      scores: { tests: passed ? 1 : 0 },
    });
  }

  private async runTestCommand(
    artifactVersionId: string,
    digest: string,
    input: EvaluateInput,
  ): Promise<EvaluationRecord> {
    const commandRef = input.criterion.commandRef;
    if (commandRef === undefined) {
      return this.evaluateTestEvidence(artifactVersionId, digest, input);
    }
    if (!this.policy || !this.process) {
      throw new ArtifactError(
        "ARTIFACT_TEST_PORTS_REQUIRED",
        "test commands must run through Policy and Process ports",
        { details: { commandRef } },
      );
    }
    const action = {
      type: "evaluation.test.run",
      digest: sha256Hex(commandRef),
      resource: `artifactVersion:${artifactVersionId}`,
      version: artifactVersionId,
    };
    const decision = await this.policy.decide(action);
    if (decision.decision === "deny") {
      return this.persist({
        artifactVersionId,
        digest,
        method: "test",
        criterionId: input.criterion.id,
        verdict: "fail",
        summary: decision.reason ?? "policy denied test command",
        evidenceRefs: [],
        scores: { tests: 0 },
      });
    }
    if (decision.decision === "require_approval") {
      return this.persist({
        artifactVersionId,
        digest,
        method: "test",
        criterionId: input.criterion.id,
        verdict: "inconclusive",
        summary: "test command requires approval",
        evidenceRefs: [],
        scores: { tests: 0 },
      });
    }
    if (input.command === undefined) {
      throw new ArtifactError(
        "ARTIFACT_TEST_PORTS_REQUIRED",
        "allowed test command is missing argv/cwd mapping; will not spawn an unmanaged shell",
        { details: { commandRef } },
      );
    }

    try {
      const captured = await this.process.spawnCaptured({
        argv: input.command.argv,
        cwd: input.command.cwd,
      });
      const exit = await waitCapturedExit(captured);
      const exitSummary = `test command ${describeProcessExit(exit)}`;
      if (!commandCriterionPassed(exit)) {
        return this.persist({
          artifactVersionId,
          digest,
          method: "test",
          criterionId: input.criterion.id,
          verdict: "fail",
          summary: `${exitSummary}; command criterion failed`,
          evidenceRefs: [],
          scores: { tests: 0 },
        });
      }
      return this.evaluateTestEvidence(
        artifactVersionId,
        digest,
        input,
        `${exitSummary}; command criterion passed`,
      );
    } catch (error) {
      if (isProcessControllerError(error) || error instanceof ProcessControllerError) {
        return this.persist({
          artifactVersionId,
          digest,
          method: "test",
          criterionId: input.criterion.id,
          verdict: "inconclusive",
          summary: `captured process ${error.operation} failed: ${error.code}; no verified exit`,
          evidenceRefs: [],
          scores: { tests: 0 },
        });
      }
      throw error;
    }
  }

  private async persist(
    input: Omit<EvaluationRecord, "id" | "createdAt"> &
      Partial<Pick<EvaluationRecord, "id" | "createdAt">>,
  ): Promise<EvaluationRecord> {
    const record: EvaluationRecord = {
      id: input.id ?? this.ids.ulid("eval_"),
      artifactVersionId: input.artifactVersionId,
      method: input.method,
      verdict: input.verdict,
      evidenceRefs: input.evidenceRefs,
      createdAt: input.createdAt ?? this.clock.now().toISOString(),
      criterionId: input.criterionId,
    };
    if (input.digest !== undefined) {
      record.digest = input.digest;
    }
    if (input.scores !== undefined) {
      record.scores = input.scores;
    }
    if (input.summary !== undefined) {
      record.summary = input.summary;
    }
    await this.store.recordEvaluation(record);
    return record;
  }
}

function isIntegrityFailure(code: string): boolean {
  return (
    code === "ARTIFACT_QUARANTINED" ||
    code === "ARTIFACT_INTEGRITY_MISMATCH" ||
    code === "ARTIFACT_CONTENT_RETAINED"
  );
}
