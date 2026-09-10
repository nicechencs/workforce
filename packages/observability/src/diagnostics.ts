import { type RedactionSummary, SecretRedactor } from "./redact.js";

export interface DiagnosticExport {
  kind: string;
  generatedAt: string;
  payload: unknown;
}

export function redactDiagnostic(
  input: DiagnosticExport,
  redactor: SecretRedactor,
): { diagnostic: DiagnosticExport; summary: RedactionSummary } {
  const payload = redactor.redactJson(input.payload);
  return {
    diagnostic: {
      kind: input.kind,
      generatedAt: input.generatedAt,
      payload: payload.value,
    },
    summary: payload.summary,
  };
}
