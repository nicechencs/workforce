import { parsePlacementSnapshot, type PlacementSnapshot } from "@workforce/protocol";

import type { PlacementCandidate } from "../../ports/index.js";
import type { ExecutionLeaseRecord, MemoryWorld, SchedulingRecord } from "../projects/store.js";
import { SCHEDULING_CANCELLED, SCHEDULING_LEASED } from "./placement.js";

const LEASE_TTL_MS = 60 * 60 * 1000;

export interface NodeSessionBinding {
  nodeId: string;
  nodeSessionId: string;
}

export interface ManagedRunLease {
  lease: ExecutionLeaseRecord;
  scheduling: SchedulingRecord;
  placementSnapshot: PlacementSnapshot;
}

/**
 * Node identity comes from the PlacementScheduler candidate. A Host session
 * only supplies nodeSessionId; missing sessions are synthesized against the
 * already-resolved candidate and are not a Project-level binding.
 */
export function nodeSessionForCandidate(
  session: NodeSessionBinding | undefined,
  candidate: PlacementCandidate,
  synthesizeSessionId: () => string,
): NodeSessionBinding {
  return {
    nodeId: candidate.nodeId,
    nodeSessionId: session?.nodeSessionId ?? synthesizeSessionId(),
  };
}

/**
 * One ExecutionLease per Run. A repeated start of the same Run returns the
 * existing lease instead of inserting a second row.
 */
export function acquireManagedRunLease(
  world: MemoryWorld,
  input: {
    runId: string;
    candidate: PlacementCandidate;
    session: NodeSessionBinding;
    reason: string;
    now: string;
  },
): ManagedRunLease {
  const existingLease = world.leaseForRun(input.runId);
  if (existingLease) {
    const placementSnapshot = snapshotForLease(
      existingLease,
      input.candidate,
      input.session,
      world.schedulingRecordForRun(input.runId)?.placementSnapshot,
    );
    const scheduling =
      world.schedulingRecordForRun(input.runId) ??
      putLeasedScheduling(world, {
        runId: input.runId,
        placementSnapshot,
        reason: input.reason,
        now: input.now,
      });
    return { lease: existingLease, scheduling, placementSnapshot };
  }

  const lease: ExecutionLeaseRecord = {
    id: world.ids.ulid("lse_"),
    runId: input.runId,
    nodeId: input.candidate.nodeId,
    fencingToken: world.nextFencingToken(),
    acquiredAt: input.now,
    renewedAt: input.now,
    expiresAt: new Date(world.clock.now().getTime() + LEASE_TTL_MS).toISOString(),
  };
  world.executionLeases.set(lease.id, lease);

  const placementSnapshot = parsePlacementSnapshot({
    nodeId: input.candidate.nodeId,
    nodeSessionId: input.session.nodeSessionId,
    runtimeInstallationId: input.candidate.runtimeInstallationId,
    workspaceInstanceId: input.candidate.workspaceInstanceId,
    executionLeaseId: lease.id,
    fencingToken: lease.fencingToken,
  });
  const existingScheduling = world.schedulingRecordForRun(input.runId);
  const scheduling = existingScheduling
    ? bindScheduling(existingScheduling, placementSnapshot)
    : putLeasedScheduling(world, {
        runId: input.runId,
        placementSnapshot,
        reason: input.reason,
        now: input.now,
      });
  return { lease, scheduling, placementSnapshot };
}

export function markRunSchedulingCancelled(world: MemoryWorld, runId: string): void {
  const record = world.schedulingRecordForRun(runId);
  if (record && record.state !== SCHEDULING_CANCELLED) {
    record.state = SCHEDULING_CANCELLED;
  }
}

function putLeasedScheduling(
  world: MemoryWorld,
  input: {
    runId: string;
    placementSnapshot: PlacementSnapshot;
    reason: string;
    now: string;
  },
): SchedulingRecord {
  const scheduling: SchedulingRecord = {
    id: world.ids.ulid("sch_"),
    runId: input.runId,
    placementSnapshot: input.placementSnapshot,
    state: SCHEDULING_LEASED,
    reason: input.reason,
    createdAt: input.now,
  };
  world.schedulingRecords.set(scheduling.id, scheduling);
  return scheduling;
}

function bindScheduling(
  scheduling: SchedulingRecord,
  placementSnapshot: PlacementSnapshot,
): SchedulingRecord {
  scheduling.placementSnapshot = placementSnapshot;
  scheduling.state = SCHEDULING_LEASED;
  return scheduling;
}

function snapshotForLease(
  lease: ExecutionLeaseRecord,
  candidate: PlacementCandidate,
  session: NodeSessionBinding,
  existing?: PlacementSnapshot,
): PlacementSnapshot {
  if (existing?.executionLeaseId === lease.id) {
    return existing;
  }
  return parsePlacementSnapshot({
    nodeId: candidate.nodeId,
    nodeSessionId: session.nodeSessionId,
    runtimeInstallationId: candidate.runtimeInstallationId,
    workspaceInstanceId: candidate.workspaceInstanceId,
    executionLeaseId: lease.id,
    fencingToken: lease.fencingToken,
  });
}
