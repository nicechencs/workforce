import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TaskRecord } from "@workforce/application";
import { OsProcessController } from "@workforce/process";
import type { StartRunRequest } from "@workforce/protocol";
import {
  createCodexRuntime,
  detectCodex,
  type CodexResolvedStartContext,
  type CodexRuntimeAdapter,
  type CodexRuntimeAdapterOptions,
} from "@workforce/runtime-codex";
import { RuntimeSdkError } from "@workforce/runtime-sdk";

import type { CompositionWorktreeHost } from "./worktree-host.js";

/**
 * Composition hook: inject the captured Process port. Production Host uses this
 * adapter. Start stays fail-closed until detect/validate/CLI, auth presence, and
 * `resolveStart` all allow. Missing binary or auth never falls back to Mock.
 */
export function createComposedCodexRuntime(
  options: Pick<CodexRuntimeAdapterOptions, "detect" | "resolveStart" | "platform"> = {},
): CodexRuntimeAdapter {
  return createCodexRuntime({
    process: new OsProcessController(),
    ...options,
  });
}

export function codexAuthFilePath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".codex", "auth.json");
}

/** Existence only. Never reads token contents. */
export function codexAuthPresent(homedir: string = os.homedir()): boolean {
  try {
    return fs.existsSync(codexAuthFilePath(homedir));
  } catch {
    return false;
  }
}

export function describeCodexHostBlocker(): string | undefined {
  const detection = detectCodex();
  if (!detection.found || detection.executable === undefined) {
    return "Codex CLI was not detected. Install the Codex CLI and retry; Host will not fall back to Mock.";
  }
  if (!codexAuthPresent()) {
    return "Codex is not authenticated (missing ~/.codex/auth.json). Host will not fall back to Mock.";
  }
  return undefined;
}

export function resolveComposedCodexStart(input: {
  request: StartRunRequest;
  worktrees: CompositionWorktreeHost;
  task?: TaskRecord;
  objective?: string;
}): CodexResolvedStartContext | undefined {
  const blocker = describeCodexHostBlocker();
  if (blocker) {
    throw new RuntimeSdkError("validation_failed", blocker, {
      details: { runtime: "codex" },
    });
  }
  const task = input.task;
  const provisioned = task
    ? input.worktrees.getForTask(task.id, input.request.attempt)
    : undefined;
  const cwd = provisioned?.worktreePath ?? (task ? input.worktrees.projectCwd(task.projectId) : undefined);
  if (!cwd || cwd.trim().length === 0) {
    return undefined;
  }
  const sandbox = task?.role === "reviewer" ? "read-only" : "workspace-write";
  return {
    cwd,
    prompt: buildCodexPrompt({
      ...(task ? { task } : {}),
      ...(input.objective ? { objective: input.objective } : {}),
    }),
    sandbox,
    approval: "never",
  };
}

function buildCodexPrompt(input: { task?: TaskRecord; objective?: string }): string {
  const task = input.task;
  const lines = [
    "You are the Workforce coding runtime. Make the requested change in this git workspace.",
    "Do not invent a success report. Leave real file changes so git diff can be captured.",
    "Do not claim evaluation pass. Workforce records evaluation separately.",
  ];
  if (input.objective) {
    lines.push(`Project objective: ${input.objective}`);
  }
  if (task) {
    lines.push(`Task: ${task.title}`);
    if (task.workflowNodeId) {
      lines.push(`Workflow node: ${task.workflowNodeId}`);
    }
    if (task.role) {
      lines.push(`Role: ${task.role}`);
    }
    const outputs = (task.expectedOutputs ?? [])
      .filter((item) => item.required)
      .map((item) => item.id)
      .join(", ");
    if (outputs.length > 0) {
      lines.push(`Required output slots: ${outputs}`);
    }
  }
  return lines.join("\n");
}
