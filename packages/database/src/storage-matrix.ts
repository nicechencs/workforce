export interface StorageLocation {
  record: string;
  location: string;
  uniqueness: string;
  recovery: string;
}

/**
 * D04 matrix: record → storage → unique constraint → recovery entry.
 * JSON carriers are explicit; they are not a second source of truth for identity.
 */
export const STORAGE_MATRIX: readonly StorageLocation[] = [
  {
    record: "NodeInstance generation",
    location: "node_instances.generation (table)",
    uniqueness: "UNIQUE (workflow_instance_id, workflow_node_id, generation)",
    recovery: "load node_instances by workflow_instance_id; resume highest generation",
  },
  {
    record: "persistent Timer / retry schedule",
    location: "timers (table; payload_json carrier for retry metadata)",
    uniqueness: "PRIMARY KEY id; due index (status, fire_at)",
    recovery: "SELECT timers WHERE status='scheduled' AND fire_at <= now",
  },
  {
    record: "Runtime Handle and process identity",
    location: "runtime_handles (table; handle_json carrier)",
    uniqueness: "PRIMARY KEY run_id; index start_identity",
    recovery: "load by run_id after restart; inspect/terminate only — do not spawn from this row",
  },
  {
    record: "start command and idempotency receipt",
    location: "command_receipts (table)",
    uniqueness:
      "UNIQUE (principal_id, client_id, canonical_operation, resource, idempotency_key); PK operation_id",
    recovery:
      "get(scope) then get run by result.runId; expired receipts remain queryable by operation_id",
  },
  {
    record: "pending approval action digest",
    location: "approvals.action_digest (table)",
    uniqueness: "PRIMARY KEY id; pending uniqueness enforced by service + status",
    recovery: "list approvals WHERE status='pending'; compare digest before consume",
  },
  {
    record: "Artifact staging / output binding",
    location: "artifact_versions.staging_ref + output_bindings (tables)",
    uniqueness: "UNIQUE (artifact_id, version); PK (task_id, slot_id) on bindings",
    recovery:
      "staging rows without available status are crash window 3; bind after metadata commit",
  },
  {
    record: "Budget / reservation / usage key",
    location:
      "budgets columns (limit/reserved/settled/authorization); budget_reservations; usage_ledger.idempotency_key",
    uniqueness:
      "PK budgets.id; PK budget_reservations.id; UNIQUE (organization_id, idempotency_key)",
    recovery:
      "load budgets + active reservations + usage keys after restart; world.json is sidecar only",
  },
  {
    record: "Policy grant (consume-once)",
    location: "policy_grants (table; not approvals)",
    uniqueness:
      "PRIMARY KEY id; UNIQUE (action_type, digest, resource, version, principal_id, policy_version)",
    recovery:
      "load by grant identity after restart; consumed_at and expiry stay fail-closed; world.json does not carry grants",
  },
  {
    record: "usage dedup and resource occupancy",
    location: "usage_ledger.idempotency_key; resource_allocations (tables)",
    uniqueness: "UNIQUE (organization_id, idempotency_key); UNIQUE run_id on allocations",
    recovery: "INSERT OR IGNORE usage; held allocations released with Run terminal status",
  },
  {
    record: "SSE ingestion position",
    location: "events.ingestion_position INTEGER PRIMARY KEY AUTOINCREMENT",
    uniqueness: "monotonic PK; UNIQUE (stream, sequence) is a different layer",
    recovery: "high-water = MAX(ingestion_position); cursor = position + filter digest",
  },
  {
    record: "Task/Run/Project state",
    location: "tasks / runs / projects tables with state_revision CAS",
    uniqueness: "PK id; UNIQUE (task_id, attempt); one active Run partial unique index",
    recovery: "UPDATE ... WHERE id=? AND state_revision=?; conflict rolls back with Event/Outbox",
  },
  {
    record: "Event + Outbox",
    location: "events + outbox_messages, same Tx as state",
    uniqueness: "events.id UNIQUE; UNIQUE (stream, sequence); outbox.id = event.id",
    recovery: "unpublished outbox WHERE published_at IS NULL; never replay Event to spawn",
  },
  {
    record: "Inbox dedup",
    location: "inbox_receipts (table)",
    uniqueness: "PRIMARY KEY (consumer, message_id)",
    recovery: "INSERT OR IGNORE; changes=0 means already processed",
  },
];
