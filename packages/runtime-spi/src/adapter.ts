import type { StartRunRequest } from "@workforce/protocol";

export type RuntimeTransport = "process" | "sdk" | "http";

export interface RuntimeCapability {
  name: string;
  version: string;
  available: boolean;
  features?: string[];
  constraints?: Record<string, unknown>;
}

export interface RuntimeDescriptor {
  adapter: {
    id: string;
    name: string;
    version: string;
    protocolVersions: string[];
  };
  runtime: {
    id: string;
    displayName: string;
    version?: string;
    transport: RuntimeTransport;
  };
  platforms: Array<"windows" | "macos" | "linux">;
  capabilities: RuntimeCapability[];
}

export interface RuntimeHandleRef {
  handleId: string;
  runId: string;
}

export interface RuntimeHandle extends RuntimeHandleRef {
  adapterId: string;
  process?: {
    pid: number;
    startIdentity: string;
  };
  createdAt: string;
}

export interface RuntimeInput {
  operationId: string;
  text?: string;
  payload?: Record<string, unknown>;
}

export interface OperationReceipt {
  operationId: string;
  accepted: boolean;
}

export type InputReceipt = OperationReceipt;

export type RuntimeStatusName =
  | "starting"
  | "running"
  | "waiting_input"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown"
  | "orphaned";

export interface RuntimeStatus {
  handle: RuntimeHandleRef;
  status: RuntimeStatusName;
  lastTrustedFactAt?: string;
}

export interface EventCursor {
  sourceCursor: string;
}

export interface RuntimeEvent {
  type: string;
  time: string;
  data: Record<string, unknown>;
  sourceCursor?: string;
}

export interface ReconciliationResult {
  attached: boolean;
  status: RuntimeStatus;
  resumeCursor?: EventCursor;
}

export interface ValidationResult {
  valid: boolean;
  runtimeVersion?: string;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export interface RuntimeConfig {
  adapterId: string;
  executable?: string;
  credentialRefs?: string[];
  options?: Record<string, unknown>;
}

export interface RuntimeAdapter {
  describe(): Promise<RuntimeDescriptor>;
  validate(config: RuntimeConfig): Promise<ValidationResult>;
  start(request: StartRunRequest): Promise<RuntimeHandle>;
  sendInput(handle: RuntimeHandleRef, input: RuntimeInput): Promise<InputReceipt>;
  pause?(handle: RuntimeHandleRef): Promise<OperationReceipt>;
  resume?(handle: RuntimeHandleRef): Promise<OperationReceipt>;
  cancel(handle: RuntimeHandleRef, reason?: string): Promise<OperationReceipt>;
  inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus>;
  stream(handle: RuntimeHandleRef, cursor?: EventCursor): AsyncIterable<RuntimeEvent>;
  reconcile(handle: RuntimeHandle): Promise<ReconciliationResult>;
  dispose?(): Promise<void>;
}
