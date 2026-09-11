import fs from "node:fs";
import path from "node:path";

import type {
  ApprovalRecord,
  ArtifactRecord,
  BudgetRecord,
  MemoryWorld,
  NodeInstanceRecord,
  ProjectRecord,
  RunRecord,
  TaskRecord,
  WorkflowInstanceRecord,
} from "@workforce/application";
import {
  isConstraintError,
  PersistenceError,
  type RuntimeHandleRecord,
  WorkforceSqlite,
} from "@workforce/database";
import type { CommandReceipt, ReceiptScope, WorkforceEvent } from "@workforce/protocol";
import type { RuntimeHostStore } from "@workforce/runtime-sdk";
import type {
  HostRuntimeEvent,
  StoredHandle,
  StoredNodeSession,
  StoredOperation,
} from "@workforce/runtime-sdk";

import { writeJsonAtomic } from "../bootstrap/state-file.js";
import type { WorkspaceDto } from "../modules/dto.js";

export interface ArtifactContentRecord {
  artifactId: string;
  versionId: string;
  logicalName: string;
  kind: string;
  mediaType: string;
  hash: string;
  size: number;
  createdAt: string;
  bodyBase64: string;
  projectId: string;
  taskId?: string;
  slotId?: string;
  parents: string[];
  children: string[];
}

export interface PersistedWorld {
  version: 1;
  clock: string;
  idsSeq: number;
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  artifacts: ArtifactRecord[];
  workflows: WorkflowInstanceRecord[];
  nodes: NodeInstanceRecord[];
  budgets: BudgetRecord[];
  usageKeys: string[];
  unknownStatuses: string[];
  reservations: Array<
    [string, { id?: string; budgetId: string; amountMinor: number; runId?: string }]
  >;
  events: WorkforceEvent[];
  receipts: CommandReceipt[];
  operations: CommandReceipt[];
  artifactContents: ArtifactContentRecord[];
  workspaces: WorkspaceDto[];
}

export interface PersistedHostStore {
  version: 1;
  operations: StoredOperation[];
  handles: StoredHandle[];
  events: HostRuntimeEvent[];
  session?: StoredNodeSession;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(scope: ReceiptScope): string {
  return [
    scope.principalId,
    scope.clientId,
    scope.canonicalOperation,
    scope.resource,
    scope.idempotencyKey,
  ].join("\u0000");
}

export class JsonRuntimeHostStore implements RuntimeHostStore {
  private readonly operations = new Map<string, StoredOperation>();
  private readonly operationsByScope = new Map<string, string>();
  private readonly handles = new Map<string, StoredHandle>();
  private readonly handlesByRunId = new Map<string, string>();
  private readonly events = new Map<string, HostRuntimeEvent[]>();
  private session: StoredNodeSession | undefined;

  constructor(private readonly persistHandle?: (record: StoredHandle) => Promise<void>) {}

  load(snapshot: PersistedHostStore | undefined): void {
    this.operations.clear();
    this.operationsByScope.clear();
    this.handles.clear();
    this.handlesByRunId.clear();
    this.events.clear();
    this.session = undefined;
    if (!snapshot) {
      return;
    }
    for (const record of snapshot.operations) {
      const stored = clone(record);
      this.operations.set(stored.operationId, stored);
      this.operationsByScope.set(scopeKey(stored.scope), stored.operationId);
    }
    for (const record of snapshot.handles) {
      const stored = clone(record);
      this.handles.set(stored.handle.handleId, stored);
      this.handlesByRunId.set(stored.handle.runId, stored.handle.handleId);
    }
    for (const event of snapshot.events) {
      const list = this.events.get(event.handleId) ?? [];
      list.push(clone(event));
      this.events.set(event.handleId, list);
    }
    this.session = snapshot.session ? clone(snapshot.session) : undefined;
  }

  dump(): PersistedHostStore {
    const snapshot: PersistedHostStore = {
      version: 1,
      operations: [...this.operations.values()].map((record) => clone(record)),
      handles: [...this.handles.values()].map((record) => clone(record)),
      events: [...this.events.values()].flat().map((event) => clone(event)),
    };
    if (this.session) {
      snapshot.session = clone(this.session);
    }
    return snapshot;
  }

  async getOperation(operationId: string): Promise<StoredOperation | undefined> {
    const record = this.operations.get(operationId);
    return record ? clone(record) : undefined;
  }

  async getOperationByScope(scope: ReceiptScope): Promise<StoredOperation | undefined> {
    const operationId = this.operationsByScope.get(scopeKey(scope));
    if (!operationId) {
      return undefined;
    }
    return this.getOperation(operationId);
  }

  async putOperation(record: StoredOperation): Promise<void> {
    const stored = clone(record);
    this.operations.set(stored.operationId, stored);
    this.operationsByScope.set(scopeKey(stored.scope), stored.operationId);
  }

  async getHandle(handleId: string): Promise<StoredHandle | undefined> {
    const record = this.handles.get(handleId);
    return record ? clone(record) : undefined;
  }

  async getHandleByRunId(runId: string): Promise<StoredHandle | undefined> {
    const handleId = this.handlesByRunId.get(runId);
    if (!handleId) {
      return undefined;
    }
    return this.getHandle(handleId);
  }

  async listHandles(): Promise<StoredHandle[]> {
    return [...this.handles.values()].map((record) => clone(record));
  }

  async putHandle(record: StoredHandle): Promise<void> {
    const stored = clone(record);
    this.handles.set(stored.handle.handleId, stored);
    this.handlesByRunId.set(stored.handle.runId, stored.handle.handleId);
    await this.persistHandle?.(stored);
  }

  async appendEvent(event: HostRuntimeEvent): Promise<void> {
    const list = this.events.get(event.handleId) ?? [];
    list.push(clone(event));
    this.events.set(event.handleId, list);
  }

  async listEvents(handleId: string, afterSequence = 0): Promise<HostRuntimeEvent[]> {
    const list = this.events.get(handleId) ?? [];
    return list.filter((event) => event.sequence > afterSequence).map((event) => clone(event));
  }

  async findEventByAdapterCursor(
    handleId: string,
    adapterCursor: string,
  ): Promise<HostRuntimeEvent | undefined> {
    const list = this.events.get(handleId) ?? [];
    const found = list.find((event) => event.adapterCursor === adapterCursor);
    return found ? clone(found) : undefined;
  }

  async getNodeSession(): Promise<StoredNodeSession | undefined> {
    return this.session ? clone(this.session) : undefined;
  }

  async putNodeSession(session: StoredNodeSession): Promise<void> {
    this.session = clone(session);
  }
}

export interface CompositionSnapshot {
  world: PersistedWorld;
  host: PersistedHostStore;
}

export function worldPath(stateDir: string): string {
  return path.join(stateDir, "world.json");
}

export function hostStorePath(stateDir: string): string {
  return path.join(stateDir, "host-store.json");
}

export function sqlitePath(stateDir: string): string {
  return path.join(stateDir, "workforce.sqlite");
}

export function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

export function dumpWorld(input: {
  world: MemoryWorld;
  operations: CommandReceipt[];
  artifactContents: ArtifactContentRecord[];
  workspaces: WorkspaceDto[];
}): PersistedWorld {
  const receiptsInner = input.world.receipts as unknown as {
    byOperation: Map<string, CommandReceipt>;
  };
  const idsInner = input.world.ids as unknown as { seq: number };
  return {
    version: 1,
    clock: input.world.nowIso(),
    idsSeq: idsInner.seq,
    projects: [...input.world.projects.values()].map((record) => clone(record)),
    tasks: [...input.world.tasks.values()].map((record) => clone(record)),
    runs: [...input.world.runs.values()].map((record) => clone(record)),
    approvals: [...input.world.approvals.values()].map((record) => clone(record)),
    artifacts: [...input.world.artifacts.values()].map((record) => clone(record)),
    workflows: [...input.world.workflows.values()].map((record) => clone(record)),
    nodes: [...input.world.nodes.values()].map((record) => clone(record)),
    budgets: [...input.world.budgets.values()].map((record) => clone(record)),
    usageKeys: [...input.world.usageKeys],
    unknownStatuses: [...input.world.unknownStatuses],
    reservations: [...input.world.reservations.entries()].map(([id, value]) => [
      id,
      clone({
        id,
        budgetId: value.budgetId,
        amountMinor: value.amountMinor,
        ...(value.runId !== undefined ? { runId: value.runId } : {}),
      }),
    ]),
    events: input.world.events.events.map((event) => clone(event)),
    receipts: [...receiptsInner.byOperation.values()].map((receipt) => clone(receipt)),
    operations: input.operations.map((receipt) => clone(receipt)),
    artifactContents: input.artifactContents.map((record) => clone(record)),
    workspaces: input.workspaces.map((record) => clone(record)),
  };
}

export async function hydrateWorld(
  world: MemoryWorld,
  snapshot: PersistedWorld,
): Promise<{
  operations: CommandReceipt[];
  artifactContents: ArtifactContentRecord[];
  workspaces: WorkspaceDto[];
}> {
  const clockInner = world.clock as unknown as { current: Date };
  clockInner.current = new Date(snapshot.clock);
  const idsInner = world.ids as unknown as { seq: number };
  idsInner.seq = snapshot.idsSeq;

  replaceMap(world.projects, snapshot.projects, (record) => record.id);
  replaceMap(world.tasks, snapshot.tasks, (record) => record.id);
  replaceMap(world.runs, snapshot.runs, (record) => record.id);
  replaceMap(world.approvals, snapshot.approvals, (record) => record.id);
  replaceMap(world.artifacts, snapshot.artifacts, (record) => record.artifactVersionId);
  replaceMap(world.workflows, snapshot.workflows, (record) => record.id);
  replaceMap(world.nodes, snapshot.nodes, (record) => record.id);
  replaceMap(world.budgets, snapshot.budgets, (record) => record.id);

  world.usageKeys.clear();
  for (const key of snapshot.usageKeys) {
    world.usageKeys.add(key);
  }
  world.unknownStatuses.clear();
  for (const id of snapshot.unknownStatuses) {
    world.unknownStatuses.add(id);
  }
  world.reservations.clear();
  for (const [id, value] of snapshot.reservations) {
    world.reservations.set(id, {
      id,
      budgetId: value.budgetId,
      amountMinor: value.amountMinor,
      ...(value.runId !== undefined ? { runId: value.runId } : {}),
    });
  }

  world.events.events.length = 0;
  world.events.events.push(...snapshot.events.map((event) => clone(event)));

  const tx = { kind: "tx" as const };
  for (const receipt of snapshot.receipts) {
    await world.receipts.putPending(tx, {
      ...receipt,
      status: "pending",
    });
    if (receipt.status === "committed") {
      await world.receipts.complete(tx, receipt.operationId, receipt.result);
    } else if (receipt.status === "failed") {
      const error =
        receipt.result && typeof receipt.result === "object"
          ? (receipt.result as CommandReceipt["result"])
          : { code: "conflict", message: "command failed", retryable: false };
      await world.receipts.fail(
        tx,
        receipt.operationId,
        error as Parameters<MemoryWorld["receipts"]["fail"]>[2],
      );
    }
  }

  return {
    operations: snapshot.operations.map((receipt) => clone(receipt)),
    artifactContents: snapshot.artifactContents.map((record) => clone(record)),
    workspaces: snapshot.workspaces.map((record) => clone(record)),
  };
}

function replaceMap<T>(map: Map<string, T>, items: T[], keyOf: (item: T) => string): void {
  map.clear();
  for (const item of items) {
    map.set(keyOf(item), clone(item));
  }
}

export function persistSnapshot(stateDir: string, snapshot: CompositionSnapshot): void {
  fs.mkdirSync(stateDir, { recursive: true });
  writeJsonAtomic(worldPath(stateDir), snapshot.world);
  writeJsonAtomic(hostStorePath(stateDir), snapshot.host);
}

export function loadSnapshot(stateDir: string): CompositionSnapshot | undefined {
  const world = readJsonFile<PersistedWorld>(worldPath(stateDir));
  const host = readJsonFile<PersistedHostStore>(hostStorePath(stateDir)) ?? {
    version: 1,
    operations: [],
    handles: [],
    events: [],
  };
  if (!world) {
    return undefined;
  }
  return { world, host };
}

function emptyWorld(): PersistedWorld {
  return {
    version: 1,
    clock: new Date().toISOString(),
    idsSeq: 4096,
    projects: [],
    tasks: [],
    runs: [],
    approvals: [],
    artifacts: [],
    workflows: [],
    nodes: [],
    budgets: [],
    usageKeys: [],
    unknownStatuses: [],
    reservations: [],
    events: [],
    receipts: [],
    operations: [],
    artifactContents: [],
    workspaces: [],
  };
}

/** SQLite entity tables win over world.json after restart. */
export async function loadComposition(
  stateDir: string,
  sqlite: WorkforceSqlite,
): Promise<CompositionSnapshot | undefined> {
  const json = loadSnapshot(stateDir);
  const entities = sqlite.worldSnapshot.load();
  const sqliteEvents = await sqlite.events.read({ limit: 10_000 });
  if (entities.projects.length === 0) {
    return json;
  }
  let sqliteHandleRows = sqlite.handles.list();
  const persistedOperations = new Set(
    sqliteHandleRows.map((record) => storedHandleFromSqlite(record).request.operationId),
  );
  for (const handle of json?.host.handles ?? []) {
    if (!persistedOperations.has(handle.request.operationId)) {
      await persistRuntimeHandle(sqlite, handle);
    }
  }
  sqliteHandleRows = sqlite.handles.list();
  const sqliteHandles = sqliteHandleRows.map(storedHandleFromSqlite);
  const base = json?.world ?? emptyWorld();
  const sqliteHasBudgets = entities.budgets.length > 0;
  const sqliteHandlesByRunId = new Map(
    sqliteHandleRows.map((record, index) => [record.runId, sqliteHandles[index]!] as const),
  );
  const handlesByOperation = new Map(
    sqliteHandles.map((record) => [record.request.operationId, record.handle.handleId] as const),
  );
  const world: PersistedWorld = {
    ...base,
    projects: entities.projects,
    tasks: entities.tasks,
    runs: entities.runs.map((run) => {
      const handleId =
        sqliteHandlesByRunId.get(run.id)?.handle.handleId ??
        handlesByOperation.get(run.operationId);
      return handleId ? { ...run, handleId } : run;
    }),
    approvals: entities.approvals,
    artifacts: entities.artifacts,
    workflows: entities.workflows,
    nodes: entities.nodes,
    events: sqliteEvents.length > 0 ? (sqliteEvents as WorkforceEvent[]) : base.events,
    budgets: sqliteHasBudgets ? entities.budgets : base.budgets,
    reservations: sqliteHasBudgets
      ? entities.reservations.map((record) => [
          record.id,
          {
            id: record.id,
            budgetId: record.budgetId,
            amountMinor: record.amountMinor,
            ...(record.runId !== undefined ? { runId: record.runId } : {}),
          },
        ])
      : base.reservations,
    usageKeys:
      sqliteHasBudgets || entities.usageKeys.length > 0 ? entities.usageKeys : base.usageKeys,
  };
  return {
    world,
    host: {
      ...(json?.host ?? { version: 1, operations: [], events: [] }),
      handles: sqliteHandles,
    },
  };
}

export async function dualWriteSqlite(
  sqlite: WorkforceSqlite,
  snapshot: PersistedWorld,
  synced: { eventIds: Set<string>; operationIds: Set<string> },
  handles: StoredHandle[] = [],
): Promise<void> {
  const pendingEvents = snapshot.events.filter((event) => !synced.eventIds.has(event.id));
  const pendingReceipts = snapshot.receipts.filter(
    (receipt) => !synced.operationIds.has(receipt.operationId),
  );
  try {
    await sqlite.uow.withTransaction(async (tx) => {
      try {
        sqlite.worldSnapshot.save(
          tx,
          {
            projects: snapshot.projects,
            tasks: snapshot.tasks,
            workflows: snapshot.workflows,
            nodes: snapshot.nodes,
            approvals: snapshot.approvals,
            artifacts: snapshot.artifacts,
            runs: snapshot.runs,
            budgets: snapshot.budgets,
            reservations: snapshot.reservations.map(([id, value]) => ({
              id,
              budgetId: value.budgetId,
              amountMinor: value.amountMinor,
              ...(value.runId !== undefined ? { runId: value.runId } : {}),
            })),
            usageKeys: snapshot.usageKeys,
          },
          snapshot.clock,
        );
        for (const handle of handles) {
          const run = snapshot.runs.find(
            (record) => record.operationId === handle.request.operationId,
          );
          if (!run) {
            throw new Error(
              `runtime handle ${handle.handle.handleId} has no Application Run for operation ${handle.request.operationId}`,
            );
          }
          sqlite.handles.put(tx, {
            runId: run.id,
            ...runtimeHandleValues(handle, snapshot.clock),
          });
        }
      } catch (error) {
        if (!(error instanceof PersistenceError) || error.code !== "revision_conflict") {
          throw error;
        }
      }
      for (const event of pendingEvents) {
        try {
          await sqlite.events.append(tx, event);
          synced.eventIds.add(event.id);
        } catch (error) {
          if (!isConstraintError(error)) {
            throw error;
          }
          synced.eventIds.add(event.id);
        }
      }
      for (const receipt of pendingReceipts) {
        const existing = await sqlite.receipts.getByOperationId(receipt.operationId);
        if (existing) {
          synced.operationIds.add(receipt.operationId);
          continue;
        }
        await sqlite.receipts.putPending(tx, { ...receipt, status: "pending" });
        if (receipt.status === "committed") {
          await sqlite.receipts.complete(tx, receipt.operationId, receipt.result ?? {});
        } else if (receipt.status === "failed") {
          await sqlite.receipts.fail(
            tx,
            receipt.operationId,
            (receipt.result as Parameters<WorkforceSqlite["receipts"]["fail"]>[2]) ?? {
              code: "conflict",
              message: "command failed",
              retryable: false,
            },
          );
        }
        synced.operationIds.add(receipt.operationId);
      }
    });
  } catch (error) {
    if (!isConstraintError(error)) {
      throw error;
    }
  }
}

export async function persistRuntimeHandle(
  sqlite: WorkforceSqlite,
  handle: StoredHandle,
): Promise<boolean> {
  return sqlite.uow.withTransaction(async (tx) => {
    const record = runtimeHandleValues(handle, new Date().toISOString());
    return sqlite.handles.putByOperation(tx, {
      operationId: handle.request.operationId,
      ...record,
    });
  });
}

function runtimeHandleValues(
  handle: StoredHandle,
  recordedAt: string,
): Omit<RuntimeHandleRecord, "runId"> {
  const process = handle.handle.process;
  if (!process) {
    throw new Error(`runtime handle ${handle.handle.handleId} has no persistent process identity`);
  }
  return {
    pid: process.pid,
    startIdentity: process.startIdentity,
    handle,
    recordedAt,
  };
}

function storedHandleFromSqlite(record: RuntimeHandleRecord): StoredHandle {
  if (!isStoredHandle(record.handle)) {
    throw new Error(`runtime_handles row for ${record.runId} does not contain a StoredHandle`);
  }
  const handle = clone(record.handle);
  if (record.pid !== null) {
    handle.handle.process = {
      pid: record.pid,
      startIdentity: record.startIdentity,
    };
  }
  return handle;
}

function isStoredHandle(value: unknown): value is StoredHandle {
  if (!value || typeof value !== "object" || !("handle" in value) || !("request" in value)) {
    return false;
  }
  const stored = value as Partial<StoredHandle>;
  return Boolean(
    stored.handle &&
    typeof stored.handle.handleId === "string" &&
    typeof stored.handle.runId === "string" &&
    stored.request &&
    typeof stored.request.operationId === "string",
  );
}
