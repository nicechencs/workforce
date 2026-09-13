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

/**
 * Persist Policy GrantStore rows so consume-once grants survive restart.
 * Distinct from `approvals` (project gate records + action digest).
 * Forward-only: do not rewrite 001–003.
 */
export const MIGRATION_004_SQL = `
CREATE TABLE policy_grants (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  digest TEXT NOT NULL,
  resource TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  principal_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('plan','artifact','action','budget')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (action_type, digest, resource, version, principal_id, policy_version)
);
`;

/**
 * D17/D18 expand step. Additive only: new tables plus nullable columns.
 *
 * This stage deliberately adds NO `NOT NULL` and NO CHECK constraint. Existing
 * M3 Runs have no mode/transport/placement/snapshot facts, and the target
 * mutual-exclusion CHECK (`workflow_bound` requires an execution snapshot,
 * `direct` forbids one) can only be applied after the backfill has run and the
 * upgrade fixture has been rehearsed. See `docs/blueprint/10-database-schema.md`
 * §12 "T04 D17/D18 schema migration".
 *
 * Forward-only: do not rewrite 001-004.
 */
export const MIGRATION_005_SQL = `
CREATE TABLE team_drafts (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status = 'draft'),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (team_id, revision)
);

CREATE TABLE workflow_drafts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status = 'draft'),
  graph_json TEXT NOT NULL CHECK (json_valid(graph_json)),
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (workflow_id, revision)
);

CREATE TABLE authoring_change_sets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  workflow_id TEXT,
  source_run_id TEXT NOT NULL REFERENCES runs(id),
  status TEXT NOT NULL CHECK (status IN (
    'proposed','validating','applying','applied','partially_applied',
    'failed','cancelled','expired'
  )),
  proposal_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json))
);

CREATE TABLE authoring_change_set_steps (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES authoring_change_sets(id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  target_type TEXT NOT NULL CHECK (target_type IN ('team','task','workflow')),
  target_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision > 0),
  status TEXT NOT NULL CHECK (status IN (
    'pending','applying','applied','failed','cancelled','expired'
  )),
  patch_ref TEXT NOT NULL,
  result_revision INTEGER,
  failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (change_set_id, ordinal),
  UNIQUE (change_set_id, target_type, target_id)
);

CREATE TABLE project_execution_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
  team_version_id TEXT NOT NULL REFERENCES team_versions(id),
  content_hash TEXT NOT NULL,
  policy_snapshot_json TEXT NOT NULL CHECK (json_valid(policy_snapshot_json)),
  budget_snapshot_json TEXT CHECK (budget_snapshot_json IS NULL OR json_valid(budget_snapshot_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_authoring_change_sets_project
  ON authoring_change_sets(project_id, status);
CREATE INDEX idx_project_execution_snapshots_project
  ON project_execution_snapshots(project_id);

ALTER TABLE projects ADD COLUMN execution_snapshot_id TEXT;

ALTER TABLE workflow_instances ADD COLUMN execution_snapshot_id TEXT;

ALTER TABLE runs ADD COLUMN orchestration_mode TEXT;
ALTER TABLE runs ADD COLUMN transport TEXT;
ALTER TABLE runs ADD COLUMN execution_snapshot_id TEXT;
ALTER TABLE runs ADD COLUMN placement_snapshot_json TEXT;
`;

/**
 * M7 catalog drafts: WorkflowDefinition / WorkflowVersion and Team / TeamVersion.
 * Distinct from execution `workflow_versions` / `team_versions` FK stubs and from
 * 005 authoring drafts / execution snapshots.
 * Forward-only: do not rewrite 001–005.
 */
export const MIGRATION_006_SQL = `
CREATE TABLE catalog_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_revision INTEGER NOT NULL CHECK (definition_revision > 0),
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES catalog_workflows(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  immutable INTEGER NOT NULL CHECK (immutable IN (0,1)),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workflow_id, version)
);

CREATE TABLE catalog_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_revision INTEGER NOT NULL CHECK (definition_revision > 0),
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_team_versions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES catalog_teams(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  immutable INTEGER NOT NULL CHECK (immutable IN (0,1)),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (team_id, version)
);

CREATE INDEX IF NOT EXISTS idx_catalog_workflows_status
  ON catalog_workflows(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_catalog_workflow_versions_workflow
  ON catalog_workflow_versions(workflow_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_teams_status
  ON catalog_teams(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_catalog_team_versions_team
  ON catalog_team_versions(team_id, status);
`;

/**
 * D18 execution-axis expand follow-up. Runtime profile transport is additive
 * and nullable so existing M3 profile versions retain their unknown value.
 * Backfill and contract tightening are intentionally separate migrations.
 */
export const MIGRATION_007_SQL = `
ALTER TABLE runtime_profile_versions
  ADD COLUMN transport TEXT
  CHECK (transport IS NULL OR transport IN ('process', 'sdk', 'http'));
`;

/**
 * T04-MIG: audit-only execution-axis migration ledger.
 *
 * This table deliberately does not add defaults or mutate `runs`.  A row is
 * an immutable observation of one Run and one source digest.  A later source
 * digest creates another observation, which keeps the audit history available
 * while allowing the classifier to be rerun as new, explicitly supplied
 * evidence arrives.
 */
export const MIGRATION_008_SQL = `
CREATE TABLE execution_axis_migration_items (
  audit_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No foreign key: the ledger must survive a later runs rebuild,
  -- quarantine export, or legacy-row deletion during the contract step.
  run_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'already_canonical','eligible','repair_required','quarantined'
  )),
  reason TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  audited_at TEXT NOT NULL,
  UNIQUE (run_id, source_digest)
);

CREATE INDEX idx_execution_axis_migration_unresolved
  ON execution_axis_migration_items(classification, audit_sequence, run_id)
  WHERE classification IN ('eligible', 'repair_required', 'quarantined');
`;

/**
 * T20-B/D17 authoring authority.  A catalog workflow is not authorable by
 * chat until it is explicitly bound to one Project and organization.  The
 * binding is deliberately separate from catalog_workflows so historical
 * catalog rows remain readable while authoring writes fail closed.
 *
 * Forward-only: do not rewrite 001-008.  The organization/project pair is
 * checked by the database repository before insertion because the existing
 * schema does not have a composite organization/project key.
 */
export const MIGRATION_009_SQL = `
CREATE TABLE workflow_authoring_scopes (
  workflow_id TEXT PRIMARY KEY REFERENCES catalog_workflows(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX idx_workflow_authoring_scopes_project
  ON workflow_authoring_scopes(project_id, workflow_id);
CREATE INDEX idx_workflow_authoring_scopes_organization
  ON workflow_authoring_scopes(organization_id, workflow_id);
`;

/**
 * D17/P0 chat authoring metadata.  This schema intentionally contains only
 * references, hashes and redacted metadata: raw chat content, prompts and
 * proposal summaries are never durable database fields.
 */
export const MIGRATION_010_SQL = `
CREATE TABLE authoring_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  protocol_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'failed', 'closed')),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE authoring_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES authoring_sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'system', 'authoring_agent')),
  content_ref TEXT,
  content_hash TEXT NOT NULL,
  redacted_preview TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL,
  CHECK (content_ref IS NOT NULL OR redacted_preview IS NOT NULL)
);

CREATE TABLE authoring_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES authoring_sessions(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_run_id TEXT NOT NULL REFERENCES runs(id),
  protocol_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'running', 'awaiting_confirmation', 'completed',
    'failed', 'cancelled', 'closed'
  )),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  task_id TEXT,
  run_id TEXT,
  proposal_id TEXT,
  change_set_id TEXT,
  workflow_draft_id TEXT,
  patch_refs_json TEXT NOT NULL CHECK (json_valid(patch_refs_json)),
  completed_operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE authoring_proposals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES authoring_sessions(id),
  turn_id TEXT NOT NULL REFERENCES authoring_turns(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_run_id TEXT NOT NULL REFERENCES runs(id),
  proposal_ref TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  redacted_preview TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected', 'failed')),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE authoring_proposal_targets (
  proposal_id TEXT NOT NULL REFERENCES authoring_proposals(id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  target_type TEXT NOT NULL CHECK (target_type IN ('team', 'task', 'workflow')),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  target_id TEXT,
  expected_revision INTEGER,
  patch_ref TEXT NOT NULL,
  PRIMARY KEY (proposal_id, ordinal),
  UNIQUE (proposal_id, patch_ref),
  CHECK (
    (operation = 'create' AND target_id IS NULL AND expected_revision IS NULL)
    OR (operation = 'update' AND target_id IS NOT NULL AND expected_revision IS NOT NULL)
  )
);

CREATE INDEX idx_authoring_sessions_project
  ON authoring_sessions(project_id, updated_at, id);
CREATE INDEX idx_authoring_messages_session
  ON authoring_messages(session_id, created_at, id);
CREATE INDEX idx_authoring_turns_session
  ON authoring_turns(session_id, created_at, id);
CREATE INDEX idx_authoring_turns_source_run
  ON authoring_turns(source_run_id, id);
CREATE INDEX idx_authoring_proposals_turn
  ON authoring_proposals(turn_id, id);
CREATE INDEX idx_authoring_proposal_targets_patch
  ON authoring_proposal_targets(patch_ref, proposal_id);
`;

/**
 * T04-MIG S3 backfill ledger. Forward-only: do not rewrite 001–010.
 *
 * 005 only expanded nullable axis columns. This migration does not treat that
 * target DDL as executed: it records backfill / repair / quarantine outcomes so
 * the TypeScript backfill in the same transaction can fill historical Runs from
 * verified Local Node / Workspace / RuntimeProfile facts, or leave them
 * unresolved. It does not add NOT NULL or mutex CHECK.
 */
export const MIGRATION_011_SQL = `
CREATE TABLE execution_axis_backfill_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'already_canonical', 'filled', 'repair_required', 'quarantined', 'skipped_direct'
  )),
  reason TEXT NOT NULL,
  snapshot_id TEXT,
  source_digest TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE (run_id, source_digest)
);

CREATE INDEX idx_execution_axis_backfill_unresolved
  ON execution_axis_backfill_results(action, id, run_id)
  WHERE action IN ('repair_required', 'quarantined');

CREATE TABLE project_execution_snapshot_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  reason TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);

CREATE INDEX idx_project_execution_snapshot_conflicts_project
  ON project_execution_snapshot_conflicts(project_id, snapshot_id);
`;

/**
 * T04-MIG S3 switch: one ProjectExecutionSnapshot per Project, snapshot-only
 * version authority. Forward-only: do not rewrite 001–011.
 */
export const MIGRATION_012_SQL = `
CREATE TABLE execution_axis_authority (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  read_source TEXT NOT NULL CHECK (read_source = 'project_execution_snapshot'),
  switched_at TEXT NOT NULL
);

INSERT INTO execution_axis_authority (id, read_source, switched_at)
VALUES (1, 'project_execution_snapshot', '1970-01-01T00:00:00.000Z');

CREATE UNIQUE INDEX idx_project_execution_snapshots_one_per_project
  ON project_execution_snapshots(project_id);
`;

/**
 * T04-MIG S5 contract. Forward-only: do not rewrite 001–012 or treat 005's
 * nullable expand as the target DDL.
 *
 * SQLite cannot ADD CHECK / NOT NULL to existing `runs` columns inside a
 * foreign-key transaction, and unresolved historical rows must remain in
 * `runs` (events / artifacts / receipts still reference them). The target
 * enum + mutex contract is therefore applied with triggers:
 * all-NULL unrepaired rows stay readable; any populated row must be a
 * complete workflow_bound or direct snapshot; once filled, axes are immutable.
 */
export const MIGRATION_013_SQL = `
CREATE TRIGGER runs_execution_axis_contract_insert
BEFORE INSERT ON runs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'runs execution-axis contract violated')
  WHERE NOT (
    (
      NEW.orchestration_mode IS NULL
      AND NEW.transport IS NULL
      AND NEW.execution_snapshot_id IS NULL
      AND NEW.placement_snapshot_json IS NULL
    )
    OR (
      NEW.orchestration_mode = 'workflow_bound'
      AND NEW.transport IN ('process', 'sdk', 'http')
      AND NEW.execution_snapshot_id IS NOT NULL
      AND NEW.placement_snapshot_json IS NOT NULL
      AND json_valid(NEW.placement_snapshot_json)
    )
    OR (
      NEW.orchestration_mode = 'direct'
      AND NEW.transport IN ('process', 'sdk', 'http')
      AND NEW.execution_snapshot_id IS NULL
      AND NEW.placement_snapshot_json IS NOT NULL
      AND json_valid(NEW.placement_snapshot_json)
    )
  );
END;

CREATE TRIGGER runs_execution_axis_contract_update
BEFORE UPDATE ON runs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'runs execution-axis contract violated')
  WHERE NOT (
    (
      NEW.orchestration_mode IS NULL
      AND NEW.transport IS NULL
      AND NEW.execution_snapshot_id IS NULL
      AND NEW.placement_snapshot_json IS NULL
    )
    OR (
      NEW.orchestration_mode = 'workflow_bound'
      AND NEW.transport IN ('process', 'sdk', 'http')
      AND NEW.execution_snapshot_id IS NOT NULL
      AND NEW.placement_snapshot_json IS NOT NULL
      AND json_valid(NEW.placement_snapshot_json)
    )
    OR (
      NEW.orchestration_mode = 'direct'
      AND NEW.transport IN ('process', 'sdk', 'http')
      AND NEW.execution_snapshot_id IS NULL
      AND NEW.placement_snapshot_json IS NOT NULL
      AND json_valid(NEW.placement_snapshot_json)
    )
  );
  SELECT RAISE(ABORT, 'runs execution-axis snapshot is immutable')
  WHERE NOT (
      OLD.orchestration_mode IS NULL
      AND OLD.transport IS NULL
      AND OLD.execution_snapshot_id IS NULL
      AND OLD.placement_snapshot_json IS NULL
    )
    AND (
      NEW.orchestration_mode IS NOT OLD.orchestration_mode
      OR NEW.transport IS NOT OLD.transport
      OR NEW.execution_snapshot_id IS NOT OLD.execution_snapshot_id
      OR NEW.placement_snapshot_json IS NOT OLD.placement_snapshot_json
    );
END;
`;

/**
 * T04-PROJECTION-RECONCILIATION. Forward-only: do not rewrite 001–013.
 *
 * 011–013 are T04-MIG execution-axis backfill / switch / contract. This ledger
 * makes world/SQLite projection failures and old sidecar repair queryable;
 * `world_projection_meta` is the restart clock/ids authority so a stale
 * `world.json` cannot be chosen silently.
 */
export const MIGRATION_014_SQL = `
CREATE TABLE world_projection_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  clock TEXT NOT NULL,
  ids_seq INTEGER NOT NULL CHECK (ids_seq >= 0),
  unknown_statuses_json TEXT NOT NULL CHECK (json_valid(unknown_statuses_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE projection_reconciliation_items (
  audit_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  source_digest TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'sqlite_authority',
    'sidecar_repaired',
    'sidecar_stale_ignored',
    'projection_failed',
    'repair_failed',
    'partial_projection'
  )),
  reason TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE (source_digest, classification)
);

CREATE INDEX idx_projection_reconciliation_unresolved
  ON projection_reconciliation_items(classification, audit_sequence)
  WHERE classification IN ('projection_failed', 'repair_failed', 'partial_projection');
`;

/**
 * Role version library. Forward-only: do not rewrite 001–014.
 *
 * 001 `worker_versions` remains the execution FK stub (runs.worker_version_id).
 * It is not the library: identity, immutable published versions, draft CAS,
 * archive, and fork copies live in catalog_workers / catalog_worker_versions /
 * worker_drafts. Team references are queried from catalog_team_versions JSON.
 */
export const MIGRATION_015_SQL = `
CREATE TABLE catalog_workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  protocol_version TEXT NOT NULL CHECK (protocol_version = '0.1'),
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  definition_revision INTEGER NOT NULL CHECK (definition_revision > 0),
  active_version_id TEXT,
  forked_from_worker_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_worker_versions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES catalog_workers(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  immutable INTEGER NOT NULL CHECK (immutable IN (0,1)),
  archived INTEGER NOT NULL CHECK (archived IN (0,1)),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  runtime_profile_id TEXT,
  forked_from_worker_version_id TEXT,
  state_revision INTEGER NOT NULL CHECK (state_revision > 0),
  published_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (worker_id, version),
  CHECK (
    (status = 'published' AND immutable = 1)
    OR (status = 'draft' AND immutable = 0)
  ),
  CHECK (
    (archived = 0 AND archived_at IS NULL)
    OR (archived = 1 AND archived_at IS NOT NULL)
  )
);

CREATE TABLE worker_drafts (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES catalog_workers(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status = 'draft'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  runtime_profile_id TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (worker_id, revision)
);

CREATE INDEX idx_catalog_workers_status
  ON catalog_workers(status, updated_at, id);
CREATE INDEX idx_catalog_worker_versions_worker
  ON catalog_worker_versions(worker_id, status, archived);
CREATE INDEX idx_worker_drafts_worker
  ON worker_drafts(worker_id, revision);

CREATE TRIGGER catalog_worker_versions_immutable_update
BEFORE UPDATE ON catalog_worker_versions
FOR EACH ROW
WHEN OLD.immutable = 1
BEGIN
  SELECT RAISE(ABORT, 'published worker version is immutable')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.worker_id IS NOT OLD.worker_id
     OR NEW.version IS NOT OLD.version
     OR NEW.status IS NOT OLD.status
     OR NEW.immutable IS NOT OLD.immutable
     OR NEW.name IS NOT OLD.name
     OR NEW.description IS NOT OLD.description
     OR NEW.role IS NOT OLD.role
     OR NEW.runtime_profile_id IS NOT OLD.runtime_profile_id
     OR NEW.forked_from_worker_version_id IS NOT OLD.forked_from_worker_version_id
     OR NEW.state_revision IS NOT OLD.state_revision
     OR NEW.published_at IS NOT OLD.published_at;
END;
`;

export const MIGRATIONS = [
  { version: "001_init", sql: MIGRATION_001_SQL },
  { version: "002_entity_alignment", sql: MIGRATION_002_SQL },
  { version: "003_budget_alignment", sql: MIGRATION_003_SQL },
  { version: "004_policy_grants", sql: MIGRATION_004_SQL },
  { version: "005_execution_axes_expand", sql: MIGRATION_005_SQL },
  { version: "006_catalog_definitions", sql: MIGRATION_006_SQL },
  { version: "007_runtime_profile_transport_expand", sql: MIGRATION_007_SQL },
  { version: "008_execution_axis_migration_audit", sql: MIGRATION_008_SQL },
  { version: "009_workflow_authoring_scopes", sql: MIGRATION_009_SQL },
  { version: "010_authoring_chat_metadata", sql: MIGRATION_010_SQL },
  { version: "011_execution_axes_backfill", sql: MIGRATION_011_SQL },
  { version: "012_execution_axes_switch", sql: MIGRATION_012_SQL },
  { version: "013_execution_axes_contract", sql: MIGRATION_013_SQL },
  { version: "014_projection_reconciliation", sql: MIGRATION_014_SQL },
  { version: "015_worker_library", sql: MIGRATION_015_SQL },
] as const;
