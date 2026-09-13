import type { AcceptanceCriterion } from "@workforce/protocol";

import { fnv1a64Hex } from "./digest.js";
import { parsePlanArtifact } from "./schema.js";
import {
  PLAN_PROTOCOL,
  PLAN_PROTOCOL_VERSION,
  SOFTWARE_DEVELOPMENT_TEAM_BOUNDS,
  SOFTWARE_DEVELOPMENT_TEAM_TEMPLATE_ID,
  type PlanArtifact,
} from "./types.js";

const TEMPLATE_VERSION = "0.1.0";
const POLICY_REF = "software-development-team.default@0.1.0";
const WORKFLOW_ID = "software-development-team.feature-delivery";

const DEFAULT_CODE_OUTPUT = {
  id: "out_code_change",
  name: "Code changes",
  kind: "code" as const,
  required: true,
  cardinality: { min: 1, max: 1 },
  mediaTypes: ["application/vnd.workforce.patch"],
  schema: { type: "git_diff", baseRef: "immutable-base" },
};

const DEFAULT_TEST_OUTPUT = {
  id: "out_test_result",
  name: "Slice test result",
  kind: "evaluation" as const,
  required: true,
  mediaTypes: ["application/vnd.workforce.test-result+json"],
};

const DEFAULT_REVIEW_OUTPUT = {
  id: "out_review_report",
  name: "Code review report",
  kind: "evaluation" as const,
  required: true,
  cardinality: { min: 1, max: 1 },
  mediaTypes: ["application/vnd.workforce.review+json"],
};

export type PlanAcceptanceInput = AcceptanceCriterion | string;

export interface GenerateSoftwareDevelopmentPlanInput {
  objective: string;
  /** Project-level acceptance. Empty/absent still yields schema+test/review criteria. */
  acceptanceCriteria?: readonly PlanAcceptanceInput[];
  baseSha?: string;
}

/**
 * Builds a software-development-team Plan Artifact from the project objective
 * and acceptance criteria. This is the start-planning source of truth;
 * callers must not substitute `mockPlanFixture` for an empty body.
 */
export function generateSoftwareDevelopmentPlan(
  input: GenerateSoftwareDevelopmentPlanInput,
): PlanArtifact {
  const objective = input.objective.trim();
  if (objective === "") {
    throw new Error("planner objective is required");
  }
  const acceptance = normalizeAcceptance(input.acceptanceCriteria);
  const developerAcceptance: AcceptanceCriterion[] = [
    {
      id: "ac_patch_schema",
      type: "schema",
      schemaRef: "https://workforce.local/protocols/v0.1/expected-output.schema.json",
    },
    { id: "ac_tests", type: "test", commandRef: "test.default" },
    ...acceptance,
  ];
  const reviewerAcceptance: AcceptanceCriterion[] = [
    { id: "ac_review", type: "review" },
    { id: "ac_digest_match", type: "rule", commandRef: "artifact.digest.match" },
    ...acceptance,
  ];
  const document = {
    protocol: PLAN_PROTOCOL,
    protocolVersion: PLAN_PROTOCOL_VERSION,
    templateId: SOFTWARE_DEVELOPMENT_TEAM_TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    workflowId: WORKFLOW_ID,
    objective,
    baseSha: input.baseSha ?? placeholderBaseSha(objective),
    policyRef: POLICY_REF,
    runtime: { adapterId: "mock", protocolVersion: "0.1" },
    bounds: { ...SOFTWARE_DEVELOPMENT_TEAM_BOUNDS },
    nodes: [
      {
        id: "dev_alpha",
        kind: "task",
        role: "developer",
        workerRef: "developer",
        title: "Implement slice Alpha",
        objective: `Deliver the Alpha slice for: ${objective}`,
        expectedOutputs: [DEFAULT_CODE_OUTPUT, DEFAULT_TEST_OUTPUT],
        acceptanceCriteria: developerAcceptance,
        maxAttempts: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxAttempts,
        maxReworkCycles: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxReworkCycles,
      },
      {
        id: "dev_bravo",
        kind: "task",
        role: "developer",
        workerRef: "developer",
        title: "Implement slice Bravo",
        objective: `Deliver the Bravo slice for: ${objective}`,
        expectedOutputs: [DEFAULT_CODE_OUTPUT, DEFAULT_TEST_OUTPUT],
        acceptanceCriteria: developerAcceptance,
        maxAttempts: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxAttempts,
        maxReworkCycles: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxReworkCycles,
      },
      {
        id: "review_integration",
        kind: "task",
        role: "reviewer",
        workerRef: "reviewer",
        title: "Review integrated delivery",
        objective: `Review the integrated worktree for: ${objective}`,
        expectedOutputs: [DEFAULT_REVIEW_OUTPUT],
        acceptanceCriteria: reviewerAcceptance,
        maxAttempts: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxAttempts,
        maxReworkCycles: SOFTWARE_DEVELOPMENT_TEAM_BOUNDS.maxReworkCycles,
      },
      {
        id: "approve_delivery",
        kind: "approval",
        role: "human",
        gate: "artifact",
        title: "Accept integrated delivery",
        objective: `Human acceptance of the integrated digest for: ${objective}`,
      },
    ],
    edges: [
      {
        id: "e_alpha_review",
        from: "dev_alpha",
        to: "review_integration",
        onUpstream: "outputs_ready",
      },
      {
        id: "e_bravo_review",
        from: "dev_bravo",
        to: "review_integration",
        onUpstream: "outputs_ready",
      },
      {
        id: "e_review_approve",
        from: "review_integration",
        to: "approve_delivery",
        onUpstream: "outputs_ready",
      },
    ],
    integration: {
      strategy: "stable_node_id_order",
      worktree: "dedicated",
      contributorNodeIds: ["dev_alpha", "dev_bravo"],
      bindDigestTo: ["review_integration", "approve_delivery"],
      onConflict: "human",
    },
  };
  const parsed = parsePlanArtifact(document);
  if (!parsed.ok) {
    throw new Error(`generated plan is invalid: ${parsed.error.message}`);
  }
  return parsed.plan;
}

function normalizeAcceptance(
  input: readonly PlanAcceptanceInput[] | undefined,
): AcceptanceCriterion[] {
  if (!input || input.length === 0) {
    return [{ id: "ac_objective", type: "rule", commandRef: "project.objective" }];
  }
  return input.map((item, index) => {
    if (typeof item === "string") {
      const text = item.trim();
      return {
        id: `ac_project_${index + 1}`,
        type: "rule",
        commandRef: text.length > 0 ? text : "project.acceptance",
      };
    }
    return item;
  });
}

function placeholderBaseSha(objective: string): string {
  const hex = fnv1a64Hex(objective);
  return `${hex}${hex}${hex}`.slice(0, 40);
}
