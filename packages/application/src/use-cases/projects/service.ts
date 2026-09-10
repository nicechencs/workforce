import type { EnginePort } from "./engine-port.js";
import { MemoryWorld } from "./store.js";
import type { AppContext } from "./context.js";
import { FakeRuntimeHost, type RuntimeHostPort } from "../runs/host.js";
import {
  cancelProject,
  confirmPlan,
  createProject,
  pauseProject,
  startExecution,
  startPlanning,
} from "./projects.js";
import {
  bindTaskOutput,
  cancelTask,
  queueTask,
  requestTaskChanges,
  retryTask,
} from "../tasks/tasks.js";
import {
  cancelRun,
  pauseRun,
  recordRunFailed,
  recordRunSucceeded,
  startRun,
} from "../runs/runs.js";
import { createApproval, decideApproval } from "../approvals/approvals.js";
import {
  raiseProjectBudget,
  releaseRunBudget,
  reserveRunBudget,
  settleRunUsage,
} from "../budgets/budgets.js";
import { markRunUnknown, reconcile } from "../recovery/recovery.js";

export interface WorkforceAppOptions {
  engine: EnginePort;
  host?: RuntimeHostPort;
  principalId?: string;
  clientId?: string;
}

/**
 * In-memory composition for T09. T04 UoW / T05 Host plug in through EnginePort
 * and RuntimeHostPort; this default world does not open sqlite or spawn Codex.
 */
export class WorkforceApp {
  readonly world: MemoryWorld;
  readonly ctx: AppContext;

  constructor(options: WorkforceAppOptions) {
    this.world = new MemoryWorld();
    this.ctx = {
      world: this.world,
      engine: options.engine,
      host: options.host ?? new FakeRuntimeHost(),
      principalId: options.principalId ?? "usr_local",
      clientId: options.clientId ?? "cli_local",
    };
  }

  createProject = (input: Parameters<typeof createProject>[1]) => createProject(this.ctx, input);
  startPlanning = (input: Parameters<typeof startPlanning>[1]) => startPlanning(this.ctx, input);
  confirmPlan = (input: Parameters<typeof confirmPlan>[1]) => confirmPlan(this.ctx, input);
  start = (input: Parameters<typeof startExecution>[1]) => startExecution(this.ctx, input);
  pauseProject = (input: Parameters<typeof pauseProject>[1]) => pauseProject(this.ctx, input);
  cancelProject = (input: Parameters<typeof cancelProject>[1]) => cancelProject(this.ctx, input);
  queueTask = (input: Parameters<typeof queueTask>[1]) => queueTask(this.ctx, input);
  bindTaskOutput = (input: Parameters<typeof bindTaskOutput>[1]) => bindTaskOutput(this.ctx, input);
  retryTask = (input: Parameters<typeof retryTask>[1]) => retryTask(this.ctx, input);
  requestTaskChanges = (input: Parameters<typeof requestTaskChanges>[1]) =>
    requestTaskChanges(this.ctx, input);
  cancelTask = (input: Parameters<typeof cancelTask>[1]) => cancelTask(this.ctx, input);
  startRun = (input: Parameters<typeof startRun>[1]) => startRun(this.ctx, input);
  recordRunSucceeded = (runId: string) => recordRunSucceeded(this.ctx, runId);
  recordRunFailed = (runId: string) => recordRunFailed(this.ctx, runId);
  cancelRun = (input: Parameters<typeof cancelRun>[1]) => cancelRun(this.ctx, input);
  pauseRun = (runId: string) => pauseRun(this.ctx, runId);
  createApproval = (input: Parameters<typeof createApproval>[1]) => createApproval(this.ctx, input);
  decideApproval = (input: Parameters<typeof decideApproval>[1]) => decideApproval(this.ctx, input);
  reserveBudget = (input: Parameters<typeof reserveRunBudget>[1]) =>
    reserveRunBudget(this.ctx, input);
  releaseBudget = (reservationId: string) => releaseRunBudget(this.ctx, reservationId);
  settleUsage = (input: Parameters<typeof settleRunUsage>[1]) => settleRunUsage(this.ctx, input);
  raiseBudget = (input: Parameters<typeof raiseProjectBudget>[1]) =>
    raiseProjectBudget(this.ctx, input);
  reconcile = (projectId: string) => reconcile(this.ctx, projectId);
  markRunUnknown = (runId: string) => markRunUnknown(this.ctx, runId);
}

export function createWorkforceApp(options: WorkforceAppOptions): WorkforceApp {
  return new WorkforceApp(options);
}
