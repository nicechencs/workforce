import { parseStartRunRequest, type StartRunRequest } from "@workforce/protocol";

export { parseStartRunRequest, type StartRunRequest };

export const DEFAULT_LOCAL_NODE_ID = "ndl_01JTESTLOCALNODE000000000";

export function createStartRunRequest(
  overrides: {
    operationId?: string;
    idempotencyKey?: string;
    taskId?: string;
    definitionRevision?: number;
    generation?: number;
    attempt?: number;
    principalId?: string;
    clientId?: string;
    snapshotRef?: string;
    placement?: Partial<StartRunRequest["placement"]>;
    runtime?: Partial<StartRunRequest["runtime"]>;
    orchestrationMode?: StartRunRequest["orchestrationMode"];
  } = {},
): StartRunRequest {
  const taskId = overrides.taskId ?? "tsk_01JTESTDEVELOPERA0000000000";
  const definitionRevision = overrides.definitionRevision ?? 1;
  const generation = overrides.generation ?? 1;
  const attempt = overrides.attempt ?? 1;
  return parseStartRunRequest({
    operationId: overrides.operationId ?? "op_01JTESTSTARTDEVA00000000000",
    idempotencyKey:
      overrides.idempotencyKey ??
      `start:${taskId}:definitionRevision:${definitionRevision}:generation:${generation}:attempt:${attempt}`,
    taskId,
    definitionRevision,
    generation,
    attempt,
    principalId: overrides.principalId ?? "usr_01JTESTOWNER00000000000000",
    clientId: overrides.clientId ?? "cli_01JTESTDESKTOP00000000000",
    placement: {
      executionNodeId: overrides.placement?.executionNodeId ?? DEFAULT_LOCAL_NODE_ID,
      runtimeInstallationId:
        overrides.placement?.runtimeInstallationId ?? "rtm_01JTESTMOCKINSTALL000000",
      workspaceInstanceId:
        overrides.placement?.workspaceInstanceId ?? "wsi_01JTESTDEVA_WT0000000000",
    },
    runtime: {
      adapterId: overrides.runtime?.adapterId ?? "mock",
      protocolVersion: overrides.runtime?.protocolVersion ?? "0.1",
    },
    snapshotRef: overrides.snapshotRef ?? "snap_01JTESTDEVA_TASKDEF000000",
    ...(overrides.orchestrationMode !== undefined
      ? { orchestrationMode: overrides.orchestrationMode }
      : {}),
  });
}
