import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiffArtifactProposal } from "@workforce/application";
import type { GitWorkspaceService } from "@workforce/workspace";

import { runMockGit } from "./worktree-host.js";

const encoder = new TextEncoder();

export function isGitDiffSlot(slotId: string): boolean {
  const slot = slotId.toLowerCase();
  return (
    slot.includes("code") ||
    slot.includes("change") ||
    slot.includes("patch") ||
    slot.includes("diff")
  );
}

export function mockSliceFileName(nodeId: string): string {
  return `${sanitizeFileToken(nodeId)}.ts`;
}

export function mockSliceSource(nodeId: string): string {
  return `export const ${sanitizeIdent(nodeId)} = true;\n`;
}

export async function writeMockSlice(worktreePath: string, nodeId: string): Promise<string> {
  const fileName = mockSliceFileName(nodeId);
  await writeFile(path.join(worktreePath, fileName), mockSliceSource(nodeId), "utf8");
  return fileName;
}

export async function captureMockPatch(input: {
  git: GitWorkspaceService;
  instanceId: string;
  worktreePath: string;
  nodeId: string;
}): Promise<DiffArtifactProposal> {
  await writeMockSlice(input.worktreePath, input.nodeId);
  let captured = await input.git.captureDiff(input.instanceId);
  if (captured.patch.trim().length === 0) {
    await commitMockSlice(input.worktreePath, input.nodeId);
    captured = await input.git.captureDiff(input.instanceId);
  }
  if (captured.patch.trim().length === 0) {
    throw new Error(`captureDiff produced an empty patch for ${input.nodeId}`);
  }
  return captured;
}

export function gitDiffArtifactFromCapture(
  captured: DiffArtifactProposal,
  nodeId: string,
): {
  mediaType: string;
  kind: "git_diff";
  body: Uint8Array;
  metadata: Record<string, unknown>;
} {
  const patch = captured.patch.endsWith("\n") ? captured.patch : `${captured.patch}\n`;
  return {
    mediaType: "text/x-diff",
    kind: "git_diff",
    body: encoder.encode(patch),
    metadata: {
      type: "git_diff",
      baseSha: captured.baseSha,
      baseRef: "immutable-base",
      changedPaths: captured.changedPaths,
      nodeId,
    },
  };
}

async function commitMockSlice(worktreePath: string, nodeId: string): Promise<void> {
  await runMockGit(worktreePath, ["add", "-A"]);
  await runMockGit(worktreePath, ["commit", "-m", `mock ${nodeId}`]);
}

function sanitizeFileToken(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9._-]/gu, "_");
  return compact.length > 0 ? compact : "slice";
}

function sanitizeIdent(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9_]/gu, "_");
  if (compact.length === 0) {
    return "slice";
  }
  return /^[A-Za-z_]/u.test(compact) ? compact : `_${compact}`;
}
