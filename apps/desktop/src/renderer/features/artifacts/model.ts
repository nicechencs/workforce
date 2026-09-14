import type { ArtifactVersionDto } from "@workforce/desktop-client";

export function isUnversionedArtifactPath(versionId: string | undefined): boolean {
  return versionId === undefined || versionId.length === 0 || versionId === "latest";
}

export function decodeArtifactContent(body: unknown): { text: string; binary: boolean } {
  if (body instanceof Uint8Array) {
    return decodeBytes(body);
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return decodeBytes(new Uint8Array(body));
  }
  if (typeof body === "string") {
    return { text: body, binary: false };
  }
  if (typeof body === "object" && body !== null && "raw" in body) {
    const raw = (body as { raw: unknown }).raw;
    if (typeof raw === "string") {
      return { text: raw, binary: false };
    }
  }
  try {
    return { text: JSON.stringify(body, null, 2), binary: false };
  } catch {
    return { text: "[无法解码的产物内容]", binary: true };
  }
}

function decodeBytes(bytes: Uint8Array): { text: string; binary: boolean } {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 800));
  let suspicious = 0;
  for (const value of sample) {
    if (value === 0) {
      return { text: `二进制内容，${bytes.byteLength} 字节`, binary: true };
    }
    if (value < 9 || (value > 13 && value < 32)) {
      suspicious += 1;
    }
  }
  if (suspicious > sample.byteLength / 8) {
    return { text: `二进制内容，${bytes.byteLength} 字节`, binary: true };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), binary: false };
  } catch {
    return { text: `二进制内容，${bytes.byteLength} 字节`, binary: true };
  }
}

export const FIELD_UNRETURNED = "未返回";
export const EVALUATION_ROW = "判定：未返回";
export const EVALUATION_PENDING = "尚未判定";
export const EVALUATION_UNAVAILABLE =
  "没有独立 Evaluation 列表。判定看 evaluation / test_result 产物内容，不能把 Run 成功或聊天当成完成。";

export function isJudgementKind(kind: string): boolean {
  const value = kind.toLowerCase();
  return (
    value.includes("evaluation") ||
    value.includes("review") ||
    value.includes("test")
  );
}

export function evaluationRowForKind(kind: string): string {
  const value = kind.toLowerCase();
  if (value.includes("evaluation") || value.includes("review")) {
    return "判定产物：打开版本看 verdict";
  }
  if (value.includes("test")) {
    return "测试产物：打开版本看 passed / verdict";
  }
  return "判定：本产物不是 evaluation；完成门仍看 pass";
}

export function evaluationRowFromArtifacts(artifacts: ReadonlyArray<{ kind: string }>): string {
  const judged = artifacts.find((artifact) => isJudgementKind(artifact.kind));
  return judged ? evaluationRowForKind(judged.kind) : EVALUATION_PENDING;
}

export function verdictFromDecodedText(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { verdict?: unknown; passed?: unknown };
    if (typeof parsed.verdict === "string" && parsed.verdict.trim().length > 0) {
      return parsed.verdict;
    }
    if (typeof parsed.passed === "boolean") {
      return parsed.passed ? "pass" : "fail";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function artifactVersionPath(artifactId: string, versionId: string): string {
  return `/artifacts/${artifactId}/versions/${versionId}`;
}

export function artifactVersionHeading(
  artifactId: string,
  version: Pick<ArtifactVersionDto, "id" | "version" | "status" | "hash">,
): string {
  return `${artifactId} @ ${version.id}（v${version.version} · ${version.status}）`;
}
