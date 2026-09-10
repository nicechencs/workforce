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

export function artifactVersionHeading(
  artifactId: string,
  version: Pick<ArtifactVersionDto, "id" | "version" | "status" | "hash">,
): string {
  return `${artifactId} @ ${version.id}（v${version.version} · ${version.status}）`;
}
