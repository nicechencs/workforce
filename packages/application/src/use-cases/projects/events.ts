import type { WorkforceEvent } from "@workforce/protocol";
import type { Tx } from "../../ports/index.js";

import type { MemoryWorld } from "./store.js";

export async function appendEvent(
  world: MemoryWorld,
  tx: Tx,
  input: {
    type: string;
    subjectType: string;
    subjectId: string;
    projectId?: string;
    taskId?: string;
    runId?: string;
    workflowInstanceId?: string;
    data?: Record<string, unknown>;
    correlationId: string;
  },
): Promise<void> {
  const now = world.nowIso();
  const event: WorkforceEvent = {
    specVersion: "0.1",
    id: world.ids.ulid("evt_"),
    type: input.type,
    source: "workforce.workflow-engine",
    subject: { type: input.subjectType, id: input.subjectId },
    time: now,
    recordedAt: now,
    actor: { type: "service", id: "workflow-engine" },
    stream: `${input.subjectType}:${input.subjectId}`,
    correlationId: input.correlationId,
    dataContentType: "application/json",
    dataSchema: `https://workforce.local/protocols/v0.1/events/${input.type}.json`,
    data: input.data ?? {},
    sensitivity: "internal",
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.workflowInstanceId ? { workflowInstanceId: input.workflowInstanceId } : {}),
  };
  await world.events.append(tx, event);
}
