import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

export async function readBinaryFile(filePath: string): Promise<Uint8Array> {
  const buf = await readFile(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function blobKeyPath(root: string, hash: string): string {
  return path.join(root, "blobs", hash.slice(0, 2), hash);
}
