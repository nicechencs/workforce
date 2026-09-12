import { ArtifactError } from "./errors.js";
import { decodeUtf8 } from "./hash.js";

export const REGISTRABLE_KINDS = ["plan", "git_diff", "test_result", "evaluation"] as const;
export type RegistrableKind = (typeof REGISTRABLE_KINDS)[number];

export const KIND_MEDIA_TYPES: Record<RegistrableKind, string> = {
  plan: "application/vnd.workforce.plan+json",
  git_diff: "text/x-diff",
  test_result: "application/vnd.workforce.test-result+json",
  evaluation: "application/vnd.workforce.review+json",
};

const MEDIA_TYPE_TO_KIND: Record<string, RegistrableKind> = {
  "application/vnd.workforce.plan+json": "plan",
  "text/x-diff": "git_diff",
  "text/x-patch": "git_diff",
  "application/x-git-diff": "git_diff",
  "application/vnd.workforce.test-result+json": "test_result",
  "application/vnd.workforce.review+json": "evaluation",
};

export function isRegistrableKind(value: string): value is RegistrableKind {
  return (REGISTRABLE_KINDS as readonly string[]).includes(value);
}

export function inferKind(input: {
  kind?: string;
  mediaType: string;
  slotId: string;
}): RegistrableKind {
  if (input.kind !== undefined) {
    if (!isRegistrableKind(input.kind)) {
      throw new ArtifactError(
        "ARTIFACT_KIND_UNSUPPORTED",
        `unsupported artifact kind: ${input.kind}`,
        {
          details: { kind: input.kind },
        },
      );
    }
    return input.kind;
  }
  const fromMedia = MEDIA_TYPE_TO_KIND[input.mediaType];
  if (fromMedia) {
    return fromMedia;
  }
  const slot = input.slotId.toLowerCase();
  if (slot.includes("plan")) {
    return "plan";
  }
  if (slot.includes("diff") || slot.includes("code")) {
    return "git_diff";
  }
  if (slot.includes("test")) {
    return "test_result";
  }
  if (slot.includes("review") || slot.includes("report") || slot.includes("eval")) {
    return "evaluation";
  }
  throw new ArtifactError(
    "ARTIFACT_KIND_UNSUPPORTED",
    `cannot infer registrable kind from mediaType=${input.mediaType} slotId=${input.slotId}`,
    { details: { mediaType: input.mediaType, slotId: input.slotId } },
  );
}

export interface KindVerification {
  kind: RegistrableKind;
  parsed?: unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      `${label}.${key} must be a non-empty string`,
    );
  }
  return value;
}

function parseJsonBody(body: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = decodeUtf8(body);
  } catch (cause) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${label} is not valid UTF-8`, { cause });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${label} is not valid JSON`, { cause });
  }
}

function verifyPlan(body: Uint8Array): unknown {
  const parsed = asRecord(parseJsonBody(body, "plan"), "plan");
  if (parsed.protocol === "workforce.plan") {
    requireString(parsed, "protocolVersion", "plan");
    requireString(parsed, "workflowId", "plan");
    requireString(parsed, "objective", "plan");
    return parsed;
  }
  requireString(parsed, "title", "plan");
  requireString(parsed, "summary", "plan");
  if (parsed.steps !== undefined && !Array.isArray(parsed.steps)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "plan.steps must be an array when present");
  }
  return parsed;
}

function verifyEvaluation(body: Uint8Array): unknown {
  const parsed = asRecord(parseJsonBody(body, "evaluation"), "evaluation");
  const verdict = parsed.verdict;
  const passed = parsed.passed;
  const hasVerdict = typeof verdict === "string" && verdict.length > 0;
  const hasPassed = typeof passed === "boolean";
  if (!hasVerdict && !hasPassed) {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      "evaluation requires verdict (string) or passed (boolean)",
    );
  }
  if (parsed.summary !== undefined && typeof parsed.summary !== "string") {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      "evaluation.summary must be a string when present",
    );
  }
  return parsed;
}

function verifyTestResult(body: Uint8Array): unknown {
  const parsed = asRecord(parseJsonBody(body, "test_result"), "test_result");
  if (typeof parsed.passed !== "boolean") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "test_result.passed must be a boolean");
  }
  if (parsed.summary !== undefined && typeof parsed.summary !== "string") {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      "test_result.summary must be a string when present",
    );
  }
  if (parsed.command !== undefined && typeof parsed.command !== "string") {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      "test_result.command must be a string when present",
    );
  }
  return parsed;
}

function verifyGitDiff(
  body: Uint8Array,
  metadata: Record<string, unknown> | undefined,
  schema: Record<string, unknown> | undefined,
): unknown {
  let text: string;
  try {
    text = decodeUtf8(body);
  } catch (cause) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "git_diff is not valid UTF-8", { cause });
  }
  const schemaType = schema?.type;
  if (schemaType !== undefined && schemaType !== "git_diff") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "git_diff schema.type must be git_diff", {
      details: { schemaType },
    });
  }
  const metaType = metadata?.type;
  if (metaType !== undefined && metaType !== "git_diff") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "git_diff metadata.type must be git_diff");
  }
  const baseSha = metadata?.baseSha;
  const baseRef = metadata?.baseRef ?? schema?.baseRef;
  const hasSha = typeof baseSha === "string" && baseSha.length > 0;
  const hasRef = typeof baseRef === "string" && baseRef.length > 0;
  if (!hasSha && !hasRef) {
    throw new ArtifactError(
      "ARTIFACT_SCHEMA_INVALID",
      "git_diff requires metadata.baseSha or metadata.baseRef (immutable base)",
    );
  }
  if (text.length > 0) {
    const looksLikeDiff =
      text.includes("diff --git") ||
      text.includes("\n+++ ") ||
      text.startsWith("--- ") ||
      text.includes("\n--- ");
    if (!looksLikeDiff) {
      throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "git_diff body is not a unified diff");
    }
  }
  return { patch: text, baseSha, baseRef };
}

export function verifyKindContent(input: {
  kind: RegistrableKind;
  body: Uint8Array;
  metadata?: Record<string, unknown>;
  schema?: Record<string, unknown>;
}): KindVerification {
  if (input.kind === "plan") {
    return { kind: "plan", parsed: verifyPlan(input.body) };
  }
  if (input.kind === "test_result") {
    return { kind: "test_result", parsed: verifyTestResult(input.body) };
  }
  if (input.kind === "evaluation") {
    return { kind: "evaluation", parsed: verifyEvaluation(input.body) };
  }
  return {
    kind: "git_diff",
    parsed: verifyGitDiff(input.body, input.metadata, input.schema),
  };
}

export function parseTestResultPassed(body: Uint8Array): boolean {
  const parsed = verifyTestResult(body);
  return (parsed as { passed: boolean }).passed;
}

const SUMMARY_MAX = 512;
const SUMMARY_KEYS = ["title", "summary", "verdict", "passed", "objective", "command"] as const;

/**
 * Builds an auditable content summary that never includes original body bytes.
 */
export function summarizeRegistrableContent(input: {
  kind: RegistrableKind;
  hash: string;
  size: number;
  name?: string;
  metadata?: Record<string, unknown>;
  body?: Uint8Array;
}): string {
  const parts: string[] = [`kind=${input.kind}`, `digest=${input.hash}`, `size=${input.size}`];
  if (input.name !== undefined) {
    parts.push(`name=${input.name}`);
  }
  const base = input.metadata?.baseSha ?? input.metadata?.baseRef;
  if (typeof base === "string" && base.length > 0) {
    parts.push(`base=${base}`);
  }
  if (input.body !== undefined) {
    try {
      const verified = verifyKindContent({
        kind: input.kind,
        body: input.body,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
      if (verified.parsed !== null && typeof verified.parsed === "object") {
        const parsed = verified.parsed as Record<string, unknown>;
        for (const key of SUMMARY_KEYS) {
          const value = parsed[key];
          if (value === undefined || value === null) {
            continue;
          }
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            parts.push(`${key}=${String(value)}`);
          }
        }
      }
    } catch {
      parts.push("content=unreadable");
    }
  }
  const text = parts.join("; ");
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`;
}
