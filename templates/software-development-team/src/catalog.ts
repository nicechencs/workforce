import {
  DEFAULT_POLICY_REF,
  FEATURE_DELIVERY_WORKFLOW_ID,
  MOCK_ADAPTER_ID,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  type PolicyTemplate,
  type WorkerTemplate,
} from "./types.js";

const mockRuntime = {
  adapterId: MOCK_ADAPTER_ID,
  protocolVersion: "0.1" as const,
  snapshotRef: "mock:success",
};

export const plannerTemplate: WorkerTemplate = {
  id: "planner",
  version: TEMPLATE_VERSION,
  status: "published",
  role: "planner",
  runtime: mockRuntime,
  policyRef: DEFAULT_POLICY_REF,
  commandRefs: { start: "run.start", cancel: "run.cancel" },
  expectedOutputIds: ["out_plan"],
};

export const developerTemplate: WorkerTemplate = {
  id: "developer",
  version: TEMPLATE_VERSION,
  status: "published",
  role: "developer",
  runtime: mockRuntime,
  policyRef: DEFAULT_POLICY_REF,
  commandRefs: {
    start: "run.start",
    cancel: "run.cancel",
    captureDiff: "workspace.captureDiff",
  },
  expectedOutputIds: ["out_code_change", "out_test_result"],
};

export const reviewerTemplate: WorkerTemplate = {
  id: "reviewer",
  version: TEMPLATE_VERSION,
  status: "published",
  role: "reviewer",
  runtime: mockRuntime,
  policyRef: DEFAULT_POLICY_REF,
  commandRefs: { start: "run.start", cancel: "run.cancel" },
  expectedOutputIds: ["out_review_report"],
};

export const defaultPolicy: PolicyTemplate = {
  id: "software-development-team.default",
  version: TEMPLATE_VERSION,
  rules: [
    { id: "allow-workspace-read", action: "workspace.read", decision: "allow" },
    { id: "allow-workspace-write", action: "workspace.write", decision: "allow" },
    { id: "allow-git-worktree", action: "git.worktree", decision: "allow" },
    { id: "allow-git-apply", action: "git.apply", decision: "allow" },
    { id: "deny-git-push", action: "git.push", decision: "deny" },
    { id: "deny-create-pull-request", action: "git.create_pull_request", decision: "deny" },
    {
      id: "require-plan-approval",
      action: "plan.confirm",
      decision: "require_approval",
      gate: "plan",
    },
    {
      id: "require-artifact-approval",
      action: "artifact.accept",
      decision: "require_approval",
      gate: "artifact",
    },
    { id: "deny-silent-overwrite", action: "git.force_apply", decision: "deny" },
    { id: "deny-unbounded-split", action: "plan.split", decision: "deny" },
  ],
};

export const softwareDevelopmentTeamTemplate = {
  id: TEMPLATE_ID,
  version: TEMPLATE_VERSION,
  status: "published" as const,
  protocolVersion: "0.1" as const,
  runtime: { adapterId: MOCK_ADAPTER_ID, protocolVersion: "0.1" as const },
  policyRef: DEFAULT_POLICY_REF,
  workflowId: FEATURE_DELIVERY_WORKFLOW_ID,
  workers: {
    planner: plannerTemplate,
    developer: developerTemplate,
    reviewer: reviewerTemplate,
  },
  policy: defaultPolicy,
  constraints: {
    maxDepth: 4,
    maxTasks: 8,
    maxAttempts: 3,
    maxReworkCycles: 2,
    developerCompletesWithoutReviewer: true,
    autoPush: false,
    autoPullRequest: false,
    unboundedSplit: false,
    plannerVia: "task_run",
    plannerBypassTaskRun: false,
    reintegrationInvalidatesApprovals: true,
    silentOverwrite: false,
  },
  mockPlanFixture: "fixtures/mock-plan.json",
} as const;
