export const TEMPLATE_ID = "software-development-team" as const;
export const TEMPLATE_VERSION = "0.1.0" as const;
export const DEFAULT_POLICY_REF = "software-development-team.default@0.1.0" as const;
export const MOCK_ADAPTER_ID = "mock" as const;
export const FEATURE_DELIVERY_WORKFLOW_ID = "software-development-team.feature-delivery" as const;

export type WorkerRole = "planner" | "developer" | "reviewer";
export type PolicyDecisionName = "allow" | "deny" | "require_approval";

export interface TemplateRuntime {
  adapterId: typeof MOCK_ADAPTER_ID;
  protocolVersion: "0.1";
  snapshotRef?: string;
}

export interface WorkerTemplate {
  id: WorkerRole;
  version: typeof TEMPLATE_VERSION;
  status: "published";
  role: WorkerRole;
  runtime: TemplateRuntime;
  policyRef: typeof DEFAULT_POLICY_REF;
  commandRefs: Record<string, string>;
  expectedOutputIds: readonly string[];
}

export interface PolicyRule {
  id: string;
  action: string;
  decision: PolicyDecisionName;
  gate?: "plan" | "artifact" | "action" | "budget";
}

export interface PolicyTemplate {
  id: string;
  version: typeof TEMPLATE_VERSION;
  rules: readonly PolicyRule[];
}
