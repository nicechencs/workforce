import type { CommandOptions } from "@workforce/desktop-client";

import type { CanvasGraphPayload } from "./graph/types.js";
import type { WorkflowStepView } from "./model.js";

export const WORKFLOW_WRITE_METHODS = [
  "createWorkflow",
  "patchWorkflow",
  "createWorkflowVersion",
  "patchWorkflowVersion",
  "publishWorkflowVersion",
] as const;

export type WorkflowWriteMethod = (typeof WORKFLOW_WRITE_METHODS)[number];

/** Matrix M7 bodies. T02 must freeze schema; this is a typed stub, not a second protocol. */
export interface CreateWorkflowDraftInput {
  name: string;
  description: string;
}

export interface PatchWorkflowDraftInput {
  name?: string;
  description?: string;
}

export interface WorkflowVersionGraphInput {
  graph: CanvasGraphPayload;
  steps?: WorkflowStepView[];
  status?: "draft";
}

export interface WorkflowWriteResult {
  id: string;
  versionId?: string;
  status?: string;
  name?: string;
  description?: string;
}

export interface WorkflowWriteClient {
  createWorkflow?: (
    input: CreateWorkflowDraftInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult>;
  patchWorkflow?: (
    id: string,
    input: PatchWorkflowDraftInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult>;
  createWorkflowVersion?: (
    id: string,
    input: WorkflowVersionGraphInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult>;
  patchWorkflowVersion?: (
    id: string,
    versionId: string,
    input: WorkflowVersionGraphInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult>;
  publishWorkflowVersion?: (
    id: string,
    versionId: string,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult>;
}

export interface WorkflowWriteCapabilities {
  available: Record<WorkflowWriteMethod, boolean>;
  canCreateDefinition: boolean;
  canSaveDraft: boolean;
  canPublish: boolean;
  missing: WorkflowWriteMethod[];
  note: string;
}

export const WRITE_API_MISSING_NOTE =
  "M7 写接口尚未挂到 typed client（POST /workflows、PATCH /workflows/{id}、POST /workflows/{id}/versions、PATCH …/versions/{versionId}、POST …:publish）。保存与发布已禁用，不会假装成功。依赖 T02/T09/T10 写 API PR。";

export const WRITE_API_PARTIAL_NOTE =
  "部分工作流写方法已出现在 client 上，但仍不足以保存或发布。未调用的动作保持禁用，失败不会改成已发布。";

export const WRITE_API_READY_NOTE =
  "写接口方法已出现在 typed client。保存草稿走 version PATCH/POST；发布走 :publish。失败会保留画布内容。未发布图不会被 Runtime 执行。";

export function asWorkflowWriteClient(client: unknown): WorkflowWriteClient {
  return client as WorkflowWriteClient;
}

export function hasWorkflowWriteMethod<K extends WorkflowWriteMethod>(
  client: WorkflowWriteClient,
  name: K,
): client is WorkflowWriteClient & Required<Pick<WorkflowWriteClient, K>> {
  return typeof client[name] === "function";
}

export function inspectWorkflowWriteClient(client: unknown): WorkflowWriteCapabilities {
  const write = asWorkflowWriteClient(client);
  const available = {
    createWorkflow: hasWorkflowWriteMethod(write, "createWorkflow"),
    patchWorkflow: hasWorkflowWriteMethod(write, "patchWorkflow"),
    createWorkflowVersion: hasWorkflowWriteMethod(write, "createWorkflowVersion"),
    patchWorkflowVersion: hasWorkflowWriteMethod(write, "patchWorkflowVersion"),
    publishWorkflowVersion: hasWorkflowWriteMethod(write, "publishWorkflowVersion"),
  };
  const missing = WORKFLOW_WRITE_METHODS.filter((name) => !available[name]);
  const canCreateDefinition = available.createWorkflow;
  const canSaveDraft = available.patchWorkflowVersion || available.createWorkflowVersion;
  const canPublish = available.publishWorkflowVersion;
  let note = WRITE_API_MISSING_NOTE;
  if (missing.length === 0) {
    note = WRITE_API_READY_NOTE;
  } else if (missing.length < WORKFLOW_WRITE_METHODS.length) {
    note = WRITE_API_PARTIAL_NOTE;
  }
  return { available, canCreateDefinition, canSaveDraft, canPublish, missing, note };
}

export function newCommandOptions(): CommandOptions {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return {
    idempotencyKey: `idem_${bytes}`,
    operationId: `op_${bytes}`,
  };
}

export function writeErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      problem?: { detail?: string; title?: string; code?: string };
      message?: string;
    };
    if (record.problem?.detail) {
      return record.problem.detail;
    }
    if (record.problem?.title) {
      return record.problem.title;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "写接口请求失败";
}

export type PersistDraftOutcome =
  | { ok: true; workflowId: string; versionId: string; result: WorkflowWriteResult }
  | { ok: false; error: string; workflowId: string | null; versionId: string | null };

export type PublishOutcome =
  { ok: true; result: WorkflowWriteResult } | { ok: false; error: string };

export async function persistWorkflowDraft(
  client: unknown,
  input: {
    workflowId: string | null;
    versionId: string | null;
    name: string;
    description: string;
    graph: CanvasGraphPayload;
    steps: WorkflowStepView[];
  },
): Promise<PersistDraftOutcome> {
  const write = asWorkflowWriteClient(client);
  const caps = inspectWorkflowWriteClient(write);
  if (!caps.canSaveDraft) {
    return {
      ok: false,
      error: WRITE_API_MISSING_NOTE,
      workflowId: input.workflowId,
      versionId: input.versionId,
    };
  }
  let workflowId = input.workflowId;
  let versionId = isLocalDraftVersion(input.versionId) ? null : input.versionId;
  try {
    if (!workflowId || workflowId === "new") {
      if (!hasWorkflowWriteMethod(write, "createWorkflow")) {
        return {
          ok: false,
          error: "缺少 createWorkflow，无法新建草稿定义。",
          workflowId: null,
          versionId: null,
        };
      }
      const created = await write.createWorkflow(
        { name: input.name, description: input.description },
        newCommandOptions(),
      );
      workflowId = created.id;
      if (typeof created.versionId === "string" && created.versionId.length > 0) {
        versionId = created.versionId;
      }
    } else if (hasWorkflowWriteMethod(write, "patchWorkflow")) {
      await write.patchWorkflow(
        workflowId,
        { name: input.name, description: input.description },
        newCommandOptions(),
      );
    }
    const versionBody: WorkflowVersionGraphInput = {
      graph: input.graph,
      steps: input.steps,
      status: "draft",
    };
    if (versionId && hasWorkflowWriteMethod(write, "patchWorkflowVersion")) {
      const patched = await write.patchWorkflowVersion(
        workflowId,
        versionId,
        versionBody,
        newCommandOptions(),
      );
      return {
        ok: true,
        workflowId,
        versionId: patched.versionId ?? versionId,
        result: patched,
      };
    }
    if (hasWorkflowWriteMethod(write, "createWorkflowVersion")) {
      const createdVersion = await write.createWorkflowVersion(
        workflowId,
        versionBody,
        newCommandOptions(),
      );
      const nextVersionId = createdVersion.versionId ?? createdVersion.id;
      return { ok: true, workflowId, versionId: nextVersionId, result: createdVersion };
    }
    return {
      ok: false,
      error: "已创建定义，但缺少 createWorkflowVersion / patchWorkflowVersion，图未写入。",
      workflowId,
      versionId,
    };
  } catch (error) {
    return {
      ok: false,
      error: writeErrorMessage(error),
      workflowId: workflowId && workflowId !== "new" ? workflowId : null,
      versionId,
    };
  }
}

export async function publishWorkflowDraft(
  client: unknown,
  input: { workflowId: string; versionId: string },
): Promise<PublishOutcome> {
  const write = asWorkflowWriteClient(client);
  if (!hasWorkflowWriteMethod(write, "publishWorkflowVersion")) {
    return { ok: false, error: WRITE_API_MISSING_NOTE };
  }
  if (isLocalDraftVersion(input.versionId) || input.workflowId === "new") {
    return { ok: false, error: "尚未保存到服务器的本地草稿不能发布。请先保存草稿。" };
  }
  try {
    const result = await write.publishWorkflowVersion(
      input.workflowId,
      input.versionId,
      newCommandOptions(),
    );
    if (result.status && result.status !== "published") {
      return { ok: false, error: `发布未完成：服务器返回 status=${result.status}` };
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: writeErrorMessage(error) };
  }
}

export function isLocalDraftVersion(versionId: string | null): boolean {
  return versionId === null || versionId === "draft" || versionId.length === 0;
}
