export const packageName = "@workforce/observability" as const;

export { redactDiagnostic, type DiagnosticExport } from "./diagnostics.js";
export { redactEvent } from "./event.js";
export {
  REDACTED,
  REDACTION_POLICY_VERSION,
  RedactionStream,
  SecretRedactor,
  mergeSummaries,
} from "./redact.js";
export type { RedactionResult, RedactionSummary, SecretRedactorOptions } from "./redact.js";
