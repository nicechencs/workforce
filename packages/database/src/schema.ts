export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

/**
 * V0.1 initial schema. Forward-only. JSON columns are TEXT with json_valid checks.
 * ingestion_position is the SQLite-monotonic SSE cursor; stream sequence is separate.
 */
export const MIGRATION_001_SQL = `
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  UNIQUE (organization_id, type, external_id)
);

CREATE TABLE team_versions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (team_id, version)
);

CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workflow_id, version)
);

CREATE TABLE worker_versions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (worker_id, version)
);

CREATE TABLE runtime_profile_versions (
  id TEXT PRIMARY KEY,
  runtime_profile_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  adapter_type TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (runtime_profile_id, version)
);

CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (policy_id, version)
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (prompt_id, version)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'draft','planning','ready','running','paused','completed','failed','cancelled','archived'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  team_version_id TEXT REFERENCES team_versions(id),
  workflow_version_id TEXT REFERENCES workflow_versions(id),
  context_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  platform TEXT,
  root_ref TEXT NOT NULL,
  isolation TEXT,
  status TEXT NOT NULL,
  repository_json TEXT CHECK (repository_json IS NULL OR json_valid(repository_json)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE execution_nodes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  labels_json TEXT NOT NULL CHECK (json_valid(labels_json)),
  capacity_json TEXT NOT NULL CHECK (json_valid(capacity_json)),
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE runtime_installations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES execution_nodes(id),
  runtime_profile_id TEXT,
  versions_json TEXT NOT NULL CHECK (json_valid(versions_json)),
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  status TEXT NOT NULL
);

CREATE TABLE workspace_instances (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  node_id TEXT REFERENCES execution_nodes(id),
  run_id TEXT,
  root_ref TEXT,
  isolation TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  workflow_version_id TEXT REFERENCES workflow_versions(id),
  status TEXT NOT NULL CHECK (status IN (
    'created','validating','ready','running','waiting','paused','cancelling','completed','failed','cancelled'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE node_instances (
  id TEXT PRIMARY KEY,
  workflow_instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
  workflow_node_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  status TEXT NOT NULL CHECK (status IN (
    'pending','blocked','ready','active','waiting','completed','failed','skipped','cancelled'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  UNIQUE (workflow_instance_id, workflow_node_id, generation)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  workflow_instance_id TEXT REFERENCES workflow_instances(id),
  workflow_node_id TEXT,
  parent_task_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft','blocked','ready','queued','running','waiting_review','completed','failed','cancelled'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_revision INTEGER NOT NULL CHECK (definition_revision > 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  protocol_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_payloads (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, revision)
);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  condition TEXT,
  required_status TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  operation_id TEXT UNIQUE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  definition_revision INTEGER NOT NULL CHECK (definition_revision > 0),
  parent_run_id TEXT REFERENCES runs(id),
  status TEXT NOT NULL CHECK (status IN (
    'pending','starting','running','waiting_input','paused','succeeded','failed','timed_out','cancelled'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  execution_node_id TEXT,
  runtime_installation_id TEXT,
  workspace_instance_id TEXT,
  worker_version_id TEXT REFERENCES worker_versions(id),
  runtime_adapter TEXT,
  snapshot_ref TEXT,
  started_at TEXT,
  ended_at TEXT,
  heartbeat_at TEXT,
  cancel_requested_at TEXT,
  failure_code TEXT,
  failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
  created_at TEXT NOT NULL,
  UNIQUE (task_id, attempt)
);

CREATE UNIQUE INDEX idx_runs_one_active_per_task
  ON runs(task_id)
  WHERE status IN ('pending','starting','running','waiting_input','paused');

CREATE TABLE run_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE run_usage (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  input_tokens INTEGER,
  output_tokens INTEGER,
  runtime_ms INTEGER,
  api_cost_minor INTEGER,
  tool_cost_minor INTEGER,
  currency TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE runtime_handles (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  pid INTEGER,
  start_identity TEXT NOT NULL,
  handle_json TEXT NOT NULL CHECK (json_valid(handle_json)),
  recorded_at TEXT NOT NULL
);

CREATE TABLE events (
  ingestion_position INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT,
  project_id TEXT,
  workflow_instance_id TEXT,
  task_id TEXT,
  run_id TEXT,
  stream TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (stream, sequence)
);

CREATE TABLE outbox_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  published_at TEXT,
  last_error TEXT
);

CREATE TABLE inbox_receipts (
  consumer TEXT NOT NULL,
  message_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (consumer, message_id)
);

CREATE TABLE command_receipts (
  operation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','committed','failed')),
  principal_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  canonical_operation TEXT NOT NULL,
  resource TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  UNIQUE (principal_id, client_id, canonical_operation, resource, idempotency_key)
);

CREATE TABLE timers (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','fired','cancelled')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  logical_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL CHECK (version > 0),
  task_id TEXT,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('staging','available','quarantined','archived')),
  media_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_key TEXT,
  staging_ref TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, version)
);

CREATE TABLE artifact_lineage (
  output_artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  input_artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  relation TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (output_artifact_version_id, input_artifact_version_id, relation)
);

CREATE TABLE output_bindings (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  slot_id TEXT NOT NULL,
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, slot_id)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT,
  run_id TEXT,
  artifact_version_id TEXT,
  gate TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending','approved','rejected','changes_requested','expired','consumed','superseded','cancelled'
  )),
  action_digest TEXT NOT NULL,
  resource TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  requested_at TEXT NOT NULL,
  due_at TEXT,
  decided_at TEXT
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT,
  run_id TEXT,
  artifact_version_id TEXT,
  evaluator_type TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict_json TEXT NOT NULL CHECK (json_valid(verdict_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE budget_reservations (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','released','consumed','expired')),
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE usage_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  run_id TEXT,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE credential_refs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL,
  external_secret_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE node_sessions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES execution_nodes(id),
  started_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE scheduling_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  placement_snapshot_json TEXT NOT NULL CHECK (json_valid(placement_snapshot_json)),
  state TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE execution_leases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE resource_allocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  node_id TEXT,
  cpu_millis INTEGER,
  memory_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('held','released')),
  created_at TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE coordination_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  sender TEXT NOT NULL,
  recipients_json TEXT NOT NULL CHECK (json_valid(recipients_json)),
  kind TEXT NOT NULL,
  content_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_projects_org_status ON projects(organization_id, status, updated_at);
CREATE INDEX idx_tasks_dispatch ON tasks(project_id, status, priority DESC, created_at);
CREATE INDEX idx_runs_task_attempt ON runs(task_id, attempt DESC);
CREATE INDEX idx_runs_status ON runs(status, heartbeat_at);
CREATE INDEX idx_events_stream_sequence ON events(stream, sequence);
CREATE INDEX idx_events_project_position ON events(project_id, ingestion_position);
CREATE INDEX idx_events_type_position ON events(event_type, ingestion_position);
CREATE INDEX idx_outbox_unpublished ON outbox_messages(published_at, available_at);
CREATE INDEX idx_timers_due ON timers(status, fire_at);
CREATE INDEX idx_approvals_status ON approvals(status, due_at);
CREATE INDEX idx_usage_org_created ON usage_ledger(organization_id, created_at);
CREATE INDEX idx_handles_identity ON runtime_handles(start_identity);
`;

/**
 * Align entity tables with application ProjectRecord / TaskRecord /
 * WorkflowInstanceRecord so SQLite can reload them after restart.
 * Forward-only: do not rewrite 001_init.
 */
export const MIGRATION_002_SQL = `
ALTER TABLE projects ADD COLUMN runtime_id TEXT;
ALTER TABLE projects ADD COLUMN workspace_id TEXT;
ALTER TABLE projects ADD COLUMN budget_id TEXT;
ALTER TABLE projects ADD COLUMN execution_node_id TEXT;
ALTER TABLE projects ADD COLUMN runtime_installation_id TEXT;
ALTER TABLE projects ADD COLUMN workspace_instance_id TEXT;
ALTER TABLE projects ADD COLUMN workflow_instance_id TEXT;
ALTER TABLE projects ADD COLUMN plan_artifact_version_id TEXT;
ALTER TABLE projects ADD COLUMN cancel_requested_at TEXT;

ALTER TABLE tasks ADD COLUMN role TEXT;
ALTER TABLE tasks ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2;
ALTER TABLE tasks ADD COLUMN max_rework_cycles INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN expected_outputs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN output_bindings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN depends_on_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN input_artifact_version_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN next_attempt_at TEXT;

ALTER TABLE workflow_instances ADD COLUMN graph_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workflow_instances ADD COLUMN cancel_requested_at TEXT;

ALTER TABLE node_instances ADD COLUMN task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_instances_project
  ON workflow_instances(project_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_project
  ON approvals(project_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_task
  ON artifact_versions(task_id);
`;

/**
 * Align budgets / reservations / usage keys with application BudgetRecord
 * so SQLite can reload them after restart without world.json.
 * Forward-only: do not rewrite 001_init or 002_entity_alignment.
 */
export const MIGRATION_003_SQL = `
ALTER TABLE budgets ADD COLUMN project_id TEXT;
ALTER TABLE budgets ADD COLUMN limit_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN reserved_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN settled_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN authorization_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE budgets ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_budgets_project
  ON budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_budget_status
  ON budget_reservations(budget_id, status);
`;

export const MIGRATIONS = [
  { version: "001_init", sql: MIGRATION_001_SQL },
  { version: "002_entity_alignment", sql: MIGRATION_002_SQL },
  { version: "003_budget_alignment", sql: MIGRATION_003_SQL },
] as const;
