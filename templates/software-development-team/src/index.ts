export const packageName = "@workforce/template-software-development-team" as const;
export const templateId = "software-development-team" as const;
export const templateVersion = "0.1.0" as const;

export {
  defaultPolicy,
  developerTemplate,
  plannerTemplate,
  reviewerTemplate,
  softwareDevelopmentTeamTemplate,
} from "./catalog.js";
export {
  DEFAULT_POLICY_REF,
  FEATURE_DELIVERY_WORKFLOW_ID,
  MOCK_ADAPTER_ID,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
} from "./types.js";
export type {
  PolicyDecisionName,
  PolicyRule,
  PolicyTemplate,
  TemplateRuntime,
  WorkerRole,
  WorkerTemplate,
} from "./types.js";
