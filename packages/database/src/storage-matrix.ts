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
  {
    record: "Execution-axis migration audit",
    location:
      "execution_axis_migration_items (append-only table; source_json is sanitized evidence)",
    uniqueness:
      "audit_sequence PRIMARY KEY; UNIQUE (run_id, source_digest); unresolved partial index",
    recovery:
      "audit historical runs into already_canonical / eligible / repair_required / quarantined; never update runs or infer missing axes",
  },
  {
    record: "Execution-axis backfill result",
    location: "execution_axis_backfill_results (append-only; snapshot_id + source_digest only)",
    uniqueness: "id PRIMARY KEY; UNIQUE (run_id, source_digest); unresolved partial index",
    recovery:
      "011 apply fills eligible historical Runs as workflow_bound + legacy PlacementSnapshot; repair_required / quarantined rows stay all-NULL and are not consumed",
  },
  {
    record: "ProjectExecutionSnapshot uniqueness / conflicts",
    location:
      "project_execution_snapshots UNIQUE(project_id); extras in project_execution_snapshot_conflicts",
    uniqueness: "one snapshot per project after 012; conflict table PK id",
    recovery:
      "switch reads WorkflowVersion/TeamVersion only from the unique snapshot; conflicting extras are quarantined and not consumed",
  },
  {
    record: "Execution-axis contract",
    location:
      "runs_execution_axis_contract_insert/update triggers; execution_axis_authority.read_source",
    uniqueness:
      "populated runs must be workflow_bound+snapshot or direct+null snapshot; axes immutable once filled",
    recovery:
      "all-NULL unrepaired historical rows remain readable; contract rejects partial/invalid axis writes without rewriting 005",
  },
  {
    record: "world / SQLite projection reconciliation",
    location:
      "projection_reconciliation_items (append-only) + world_projection_meta (clock/ids_seq)",
    uniqueness:
      "audit_sequence PRIMARY KEY; UNIQUE (source_digest, classification); world_projection_meta id=1",
    recovery:
      "query projection_failed / repair_failed / partial_projection; restart always loads SQLite entities; old sidecar is repaired into SQLite or ignored when stale",
  },
  {
    record: "Worker library identity / version / draft",
    location:
      "catalog_workers + catalog_worker_versions + worker_drafts (015; not 001 worker_versions)",
    uniqueness:
      "PK catalog_workers.id; PK catalog_worker_versions.id UNIQUE(worker_id, version); worker_drafts PK id UNIQUE(worker_id, revision); published version insert-once + immutable trigger",
    recovery:
      "load catalog_workers after restart; published rows stay insert-once; draft CAS is MAX(revision); archive is queryable; fork inserts a new identity and does not mutate the source; TeamVersion refs are json_each(catalog_team_versions.definition_json members.workerVersionId)",
  },
];
