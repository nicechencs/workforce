import type {
  CommandOptions,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
  WorkflowDto,
  WorkflowVersionDto,
} from "@workforce/desktop-client";

import { toProtocolGraph } from "./graph/from-catalog.js";
import type { CanvasGraph, CanvasGraphPayload } from "./graph/types.js";

export const WORKFLOW_WRITE_METHODS = [
  "createWorkflow",
  "patchWorkflow",
  "createWorkflowVersion",
  "patchWorkflowVersion",
  "publishWorkflowVersion",
] as const;

export type WorkflowWriteMethod = (typeof WORKFLOW_WRITE_METHODS)[number];

export interface WorkflowWriteRevisions {
  readonly definitionRevision?: number;
  readonly versionRevision?: number;
}

export interface WorkflowWriteResult {
  id: string;
  versionId?: string;
  status?: string;
  name?: string;
  description?: string;
  stateRevision?: number;
}

export interface WorkflowWriteClient {
  createWorkflow?: (
    input: CreateWorkflowInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult | WorkflowDto>;
  patchWorkflow?: (
    id: string,
    input: PatchWorkflowInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult | WorkflowDto>;
  createWorkflowVersion?: (
    id: string,
    input: CreateWorkflowVersionInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult | WorkflowVersionDto>;
  patchWorkflowVersion?: (
    id: string,
    versionId: string,
    input: PatchWorkflowVersionInput,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult | WorkflowVersionDto>;
  publishWorkflowVersion?: (
    id: string,
    versionId: string,
    options: CommandOptions,
  ) => Promise<WorkflowWriteResult | WorkflowVersionDto>;
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
  "typed client 缺少工作流写方法，保存与发布已禁用，不会假装成功。";

export const WRITE_API_PARTIAL_NOTE =
  "部分工作流写方法已出现在 client 上，但仍不足以保存或发布。未调用的动作保持禁用，失败不会改成已发布。";

export const WRITE_API_READY_NOTE =
  "草稿保存走 POST/PATCH /workflows 与 unpublished version；发布走 :publish。未发布草稿不会出现在已发布目录，也不会被 Runtime 执行。失败会保留画布内容。";

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
  const canSaveDraft =
    available.createWorkflowVersion ||
    available.patchWorkflowVersion ||
    (available.createWorkflow && available.createWorkflowVersion);
  const canPublish = available.publishWorkflowVersion;
  let note = WRITE_API_MISSING_NOTE;
  if (missing.length === 0) {
    note = WRITE_API_READY_NOTE;
  } else if (missing.length < WORKFLOW_WRITE_METHODS.length) {
    note = WRITE_API_PARTIAL_NOTE;
  }
  return { available, canCreateDefinition, canSaveDraft, canPublish, missing, note };
}

export function newCommandOptions(ifMatch?: number): CommandOptions {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  const options: CommandOptions = {
    idempotencyKey: `idem_${bytes}`,
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
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
  | {
      ok: true;
      workflowId: string;
      versionId: string;
      revisions: Required<WorkflowWriteRevisions>;
      result: WorkflowWriteResult;
    }
  | { ok: false; error: string; workflowId: string | null; versionId: string | null };

export type PublishOutcome =
  { ok: true; result: WorkflowWriteResult } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asResourceId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is missing from the write API response.`);
  }
  return value;
}

function toVersionWriteInput(
  graph: CanvasGraph | CanvasGraphPayload,
): CreateWorkflowVersionInput & PatchWorkflowVersionInput {
  return toProtocolGraph(graph);
}

function readWorkflowId(result: unknown): string {
  if (!isRecord(result)) {
    throw new Error("createWorkflow did not return a workflow.");
  }
  return asResourceId(result.id, "workflow id");
}

function readWorkflowRevision(result: unknown, fallback?: number): number {
  if (isRecord(result)) {
    const revision = asPositiveRevision(result.stateRevision);
    if (revision !== undefined) {
      return revision;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return 1;
}

function readVersionIdentity(result: unknown): { versionId: string; versionRevision: number } {
  if (!isRecord(result)) {
    throw new Error("workflow version write did not return a resource.");
  }
  const versionId =
    typeof result.id === "string" && result.id.length > 0
      ? result.id
      : typeof result.versionId === "string"
        ? result.versionId
        : "";
  return {
    versionId: asResourceId(versionId, "workflow version id"),
    versionRevision: asPositiveRevision(result.stateRevision) ?? 1,
  };
}

function toWriteResult(
  result: unknown,
  fallback: { id: string; versionId?: string },
): WorkflowWriteResult {
  if (!isRecord(result)) {
    return fallback;
  }
  const writeResult: WorkflowWriteResult = {
    id: typeof result.id === "string" ? result.id : fallback.id,
  };
  if (typeof result.versionId === "string") {
    writeResult.versionId = result.versionId;
  } else if (fallback.versionId !== undefined) {
    writeResult.versionId = fallback.versionId;
  }
  if (typeof result.status === "string") {
    writeResult.status = result.status;
  }
  if (typeof result.name === "string") {
    writeResult.name = result.name;
  }
  if (typeof result.description === "string") {
    writeResult.description = result.description;
  }
  if (asPositiveRevision(result.stateRevision) !== undefined) {
    writeResult.stateRevision = result.stateRevision as number;
  }
  return writeResult;
}

export async function persistWorkflowDraft(
  client: unknown,
  input: {
    workflowId: string | null;
    versionId: string | null;
    name: string;
    description: string;
    graph: CanvasGraph | CanvasGraphPayload;
    steps?: unknown;
    revisions?: WorkflowWriteRevisions;
    definitionStatus?: "draft" | "published";
  },
): Promise<PersistDraftOutcome> {
  void input.steps;
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

  const name = input.name.trim() || "未命名工作流";
  const createInput: CreateWorkflowInput = input.description
    ? { name, description: input.description }
    : { name };
  const versionBody = toVersionWriteInput(input.graph);
  let workflowId = input.workflowId && input.workflowId !== "new" ? input.workflowId : null;
  const versionId = isLocalDraftVersion(input.versionId) ? null : input.versionId;
  let definitionRevision = input.revisions?.definitionRevision;
  const versionRevision = input.revisions?.versionRevision;

  try {
    if (!workflowId) {
      if (!hasWorkflowWriteMethod(write, "createWorkflow")) {
        return {
          ok: false,
          error: "缺少 createWorkflow，无法新建草稿定义。",
          workflowId: null,
          versionId: null,
        };
      }
      if (!hasWorkflowWriteMethod(write, "createWorkflowVersion")) {
        return {
          ok: false,
          error: "缺少 createWorkflowVersion，图未写入。",
          workflowId: null,
          versionId: null,
        };
      }
      const created = await write.createWorkflow(createInput, newCommandOptions());
      workflowId = readWorkflowId(created);
      definitionRevision = readWorkflowRevision(created, 1);
      const createdVersion = await write.createWorkflowVersion(
        workflowId,
        versionBody,
        newCommandOptions(definitionRevision),
      );
      const version = readVersionIdentity(createdVersion);
      return {
        ok: true,
        workflowId,
        versionId: version.versionId,
        revisions: {
          definitionRevision: definitionRevision + 1,
          versionRevision: version.versionRevision,
        },
        result: toWriteResult(createdVersion, { id: workflowId, versionId: version.versionId }),
      };
    }

    if (
      input.definitionStatus === "published" &&
      versionId === null &&
      definitionRevision === undefined &&
      hasWorkflowWriteMethod(write, "createWorkflow") &&
      hasWorkflowWriteMethod(write, "createWorkflowVersion")
    ) {
      const created = await write.createWorkflow(createInput, newCommandOptions());
      workflowId = readWorkflowId(created);
      definitionRevision = readWorkflowRevision(created, 1);
      const createdVersion = await write.createWorkflowVersion(
        workflowId,
        versionBody,
        newCommandOptions(definitionRevision),
      );
      const version = readVersionIdentity(createdVersion);
      return {
        ok: true,
        workflowId,
        versionId: version.versionId,
        revisions: {
          definitionRevision: definitionRevision + 1,
          versionRevision: version.versionRevision,
        },
        result: toWriteResult(createdVersion, { id: workflowId, versionId: version.versionId }),
      };
    }

    if (input.definitionStatus !== "published" && hasWorkflowWriteMethod(write, "patchWorkflow")) {
      if (definitionRevision === undefined) {
        return {
          ok: false,
          error: "缺少 workflow stateRevision，无法带 If-Match 更新定义。",
          workflowId,
          versionId,
        };
      }
      const patchedWorkflow = await write.patchWorkflow(
        workflowId,
        { name, ...(input.description === undefined ? {} : { description: input.description }) },
        newCommandOptions(definitionRevision),
      );
      definitionRevision = readWorkflowRevision(patchedWorkflow, definitionRevision + 1);
    }

    if (versionId && hasWorkflowWriteMethod(write, "patchWorkflowVersion")) {
      if (versionRevision === undefined) {
        return {
          ok: false,
          error: "缺少 version stateRevision，无法带 If-Match 更新草稿。",
          workflowId,
          versionId,
        };
      }
      const patched = await write.patchWorkflowVersion(
        workflowId,
        versionId,
        versionBody,
        newCommandOptions(versionRevision),
      );
      const version = readVersionIdentity(patched);
      return {
        ok: true,
        workflowId,
        versionId: version.versionId,
        revisions: {
          definitionRevision: definitionRevision ?? 1,
          versionRevision: version.versionRevision,
        },
        result: toWriteResult(patched, { id: workflowId, versionId: version.versionId }),
      };
    }

    if (hasWorkflowWriteMethod(write, "createWorkflowVersion")) {
      if (definitionRevision === undefined) {
        return {
          ok: false,
          error: "缺少 workflow stateRevision，无法带 If-Match 创建未发布 version。",
          workflowId,
          versionId,
        };
      }
      const createdVersion = await write.createWorkflowVersion(
        workflowId,
        versionBody,
        newCommandOptions(definitionRevision),
      );
      const version = readVersionIdentity(createdVersion);
      return {
        ok: true,
        workflowId,
        versionId: version.versionId,
        revisions: {
          definitionRevision: definitionRevision + 1,
          versionRevision: version.versionRevision,
        },
        result: toWriteResult(createdVersion, { id: workflowId, versionId: version.versionId }),
      };
    }

    return {
      ok: false,
      error: "已有定义，但缺少 createWorkflowVersion / patchWorkflowVersion，图未写入。",
      workflowId,
      versionId,
    };
  } catch (error) {
    const message = writeErrorMessage(error);
    if (
      workflowId &&
      versionId === null &&
      input.workflowId &&
      input.workflowId !== "new" &&
      /not found|404/i.test(message) &&
      hasWorkflowWriteMethod(write, "createWorkflow") &&
      hasWorkflowWriteMethod(write, "createWorkflowVersion")
    ) {
      try {
        const created = await write.createWorkflow(createInput, newCommandOptions());
        const copiedId = readWorkflowId(created);
        const copiedRevision = readWorkflowRevision(created, 1);
        const createdVersion = await write.createWorkflowVersion(
          copiedId,
          versionBody,
          newCommandOptions(copiedRevision),
        );
        const version = readVersionIdentity(createdVersion);
        return {
          ok: true,
          workflowId: copiedId,
          versionId: version.versionId,
          revisions: {
            definitionRevision: copiedRevision + 1,
            versionRevision: version.versionRevision,
          },
          result: toWriteResult(createdVersion, { id: copiedId, versionId: version.versionId }),
        };
      } catch (copyError) {
        return {
          ok: false,
          error: writeErrorMessage(copyError),
          workflowId: null,
          versionId: null,
        };
      }
    }
    return {
      ok: false,
      error: message,
      workflowId: workflowId && workflowId !== "new" ? workflowId : null,
      versionId,
    };
  }
}

export async function publishWorkflowDraft(
  client: unknown,
  input: { workflowId: string; versionId: string; versionRevision?: number },
): Promise<PublishOutcome> {
  const write = asWorkflowWriteClient(client);
  if (!hasWorkflowWriteMethod(write, "publishWorkflowVersion")) {
    return { ok: false, error: WRITE_API_MISSING_NOTE };
  }
  if (isLocalDraftVersion(input.versionId) || input.workflowId === "new") {
    return { ok: false, error: "尚未保存到服务器的本地草稿不能发布。请先保存草稿。" };
  }
  if (input.versionRevision === undefined) {
    return { ok: false, error: "缺少 version stateRevision，无法带 If-Match 发布。" };
  }
  try {
    const result = await write.publishWorkflowVersion(
      input.workflowId,
      input.versionId,
      newCommandOptions(input.versionRevision),
    );
    const status =
      isRecord(result) && typeof result.status === "string" ? result.status : undefined;
    if (status && status !== "published") {
      return { ok: false, error: `发布未完成：服务器返回 status=${status}` };
    }
    const identity = isRecord(result)
      ? { id: typeof result.id === "string" ? result.id : input.versionId }
      : { id: input.versionId };
    return { ok: true, result: toWriteResult(result, identity) };
  } catch (error) {
    return { ok: false, error: writeErrorMessage(error) };
  }
}

export function isLocalDraftVersion(versionId: string | null): boolean {
  return versionId === null || versionId === "draft" || versionId.length === 0;
}
