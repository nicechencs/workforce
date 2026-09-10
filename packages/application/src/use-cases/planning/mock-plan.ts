import { parsePlanArtifact } from "./schema.js";
import type { PlanArtifact } from "./types.js";

/** Fixed M3 Mock Plan: two developer tasks, one reviewer, one human artifact approval. */
export const MOCK_PLAN_DOCUMENT = {
  protocol: "workforce.plan",
  protocolVersion: "0.1",
  templateId: "software-development-team",
  templateVersion: "0.1.0",
  workflowId: "software-development-team.feature-delivery",
  objective:
    "Deliver a two-slice mock feature on a frozen baseline, then review and accept one integrated digest.",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  policyRef: "software-development-team.default@0.1.0",
  runtime: {
    adapterId: "mock",
    protocolVersion: "0.1",
  },
  bounds: {
    maxDepth: 4,
    maxTasks: 8,
    maxAttempts: 3,
    maxReworkCycles: 2,
  },
  nodes: [
    {
      id: "dev_alpha",
      kind: "task",
      role: "developer",
      workerRef: "developer",
      title: "Implement slice Alpha",
      objective: "Add the Alpha slice on the frozen baseline without touching Bravo files.",
      expectedOutputs: [
        {
          id: "out_code_change",
          name: "Code changes",
          kind: "code",
          required: true,
          cardinality: { min: 1, max: 1 },
          mediaTypes: ["application/vnd.workforce.patch"],
          schema: { type: "git_diff", baseRef: "immutable-base" },
        },
        {
          id: "out_test_result",
          name: "Slice test result",
          kind: "evaluation",
          required: true,
          mediaTypes: ["application/vnd.workforce.test-result+json"],
        },
      ],
      acceptanceCriteria: [
        {
          id: "ac_patch_schema",
          type: "schema",
          schemaRef: "https://workforce.local/protocols/v0.1/expected-output.schema.json",
        },
        { id: "ac_tests", type: "test", commandRef: "test.default" },
      ],
      maxAttempts: 3,
      maxReworkCycles: 2,
    },
    {
      id: "dev_bravo",
      kind: "task",
      role: "developer",
      workerRef: "developer",
      title: "Implement slice Bravo",
      objective: "Add the Bravo slice on the frozen baseline without touching Alpha files.",
      expectedOutputs: [
        {
          id: "out_code_change",
          name: "Code changes",
          kind: "code",
          required: true,
          cardinality: { min: 1, max: 1 },
          mediaTypes: ["application/vnd.workforce.patch"],
          schema: { type: "git_diff", baseRef: "immutable-base" },
        },
        {
          id: "out_test_result",
          name: "Slice test result",
          kind: "evaluation",
          required: true,
          mediaTypes: ["application/vnd.workforce.test-result+json"],
        },
      ],
      acceptanceCriteria: [
        {
          id: "ac_patch_schema",
          type: "schema",
          schemaRef: "https://workforce.local/protocols/v0.1/expected-output.schema.json",
        },
        { id: "ac_tests", type: "test", commandRef: "test.default" },
      ],
      maxAttempts: 3,
      maxReworkCycles: 2,
    },
    {
      id: "review_integration",
      kind: "task",
      role: "reviewer",
      workerRef: "reviewer",
      title: "Review integrated delivery",
      objective: "Review the integrated worktree bound to a single content digest.",
      expectedOutputs: [
        {
          id: "out_review_report",
          name: "Code review report",
          kind: "evaluation",
          required: true,
          cardinality: { min: 1, max: 1 },
          mediaTypes: ["application/vnd.workforce.review+json"],
        },
      ],
      acceptanceCriteria: [
        { id: "ac_review", type: "review" },
        { id: "ac_digest_match", type: "rule", commandRef: "artifact.digest.match" },
      ],
      maxAttempts: 3,
      maxReworkCycles: 2,
    },
    {
      id: "approve_delivery",
      kind: "approval",
      role: "human",
      gate: "artifact",
      title: "Accept integrated delivery",
      objective: "Human acceptance of the same integrated content digest reviewed above.",
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
} as const;

export function mockPlanFixture(): PlanArtifact {
  const parsed = parsePlanArtifact(MOCK_PLAN_DOCUMENT);
  if (!parsed.ok) {
    throw new Error(`embedded mock plan fixture is invalid: ${parsed.error.message}`);
  }
  return parsed.plan;
}
