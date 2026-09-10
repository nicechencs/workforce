import { ArtifactError } from "../errors.js";
import { collectBytes, sha256Hex } from "../hash.js";
import { parseTestResultPassed, verifyKindContent } from "../kinds.js";
import type { LocalArtifactStore } from "../registration/local-artifact-store.js";
import type { EvaluationRecord } from "../types.js";

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

export interface ProcessPort {
  spawn(req: {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
  }): Promise<{ pid: number; startIdentity: string }>;
  inspect(handle: {
    pid: number;
    startIdentity: string;
  }): Promise<{ alive: boolean; startIdentity: string }>;
  cancel(handle: { pid: number; startIdentity: string }, mode: "graceful" | "force"): Promise<void>;
}

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
    const stored = await this.store.getStored(input.artifactVersionId);
    if (stored.status === "quarantined") {
      return this.persist({
        artifactVersionId: stored.artifactVersionId,
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
    if (stored.status !== "available" && stored.status !== "archived") {
      return this.persist({
        artifactVersionId: stored.artifactVersionId,
        method: input.criterion.type,
        criterionId: input.criterion.id,
        verdict: "fail",
        summary: `subject status ${stored.status} cannot be evaluated`,
        evidenceRefs: [],
        scores: { acceptance: 0 },
      });
    }

    if (input.criterion.type === "schema") {
      return this.evaluateSchema(stored.artifactVersionId, input);
    }
    return this.evaluateTest(stored.artifactVersionId, input);
  }

  private async evaluateSchema(
    artifactVersionId: string,
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
    input: EvaluateInput,
  ): Promise<EvaluationRecord> {
    if (input.criterion.commandRef !== undefined) {
      const commandOutcome = await this.runTestCommand(artifactVersionId, input);
      if (commandOutcome !== undefined) {
        return commandOutcome;
      }
    }

    const evidenceIds = input.evidenceArtifactVersionIds ?? [];
    if (evidenceIds.length === 0) {
      return this.persist({
        artifactVersionId,
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
    for (const evidenceId of evidenceIds) {
      const evidence = await this.store.getStored(evidenceId);
      evidenceRefs.push({ artifactVersionId: evidenceId });
      if (evidence.status === "quarantined") {
        passed = false;
        summaries.push(`${evidenceId} quarantined`);
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
      method: "test",
      criterionId: input.criterion.id,
      verdict: passed ? "pass" : "fail",
      summary: passed ? "test evidence passed" : summaries.join("; "),
      evidenceRefs,
      scores: { tests: passed ? 1 : 0 },
    });
  }

  private async runTestCommand(
    artifactVersionId: string,
    input: EvaluateInput,
  ): Promise<EvaluationRecord | undefined> {
    const commandRef = input.criterion.commandRef;
    if (commandRef === undefined) {
      return undefined;
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
    const handle = await this.process.spawn({
      argv: input.command.argv,
      cwd: input.command.cwd,
    });
    await this.process.inspect(handle);
    return undefined;
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
