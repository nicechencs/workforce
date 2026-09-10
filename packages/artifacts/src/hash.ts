import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function copyBytes(body: Uint8Array): Uint8Array {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy;
}

export async function collectBytes(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    size += chunk.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function decodeUtf8(body: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
