import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import "./fastify-augment.js";

import {
  parseCreateTeamInput,
  parseCreateWorkflowInput,
  parsePatchTeamInput,
  parsePatchWorkflowInput,
  parseTeamVersionWrite,
  parseWorkflowVersionWrite,
} from "@workforce/protocol";

import { AppError } from "../modules/errors.js";
import { parseStartOrchestrationMode } from "../modules/orchestration.js";
import type { AppServices, CommandContext, ListQuery } from "../modules/index.js";
import type { IdFactory } from "../modules/ids.js";
import type { MemoryReceiptStore } from "../modules/receipts.js";
import type { SessionRegistry } from "./auth.js";
import {
  asObject,
  optionalInt,
  optionalString,
  parseLimit,
  queryString,
  queryStringList,
  rejectUnknownFields,
  requiredString,
} from "./body.js";
import { executeCommand, type CommandOutcome, type CommandSpec } from "./commands.js";
import { commandRoute, nestedVersionCommandRoute } from "./rewrite.js";

interface RouteDeps {
  services: AppServices;
  receipts: MemoryReceiptStore;
  sessions: SessionRegistry;
  ids: IdFactory;
  now: () => Date;
}

function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, string | undefined>)[name];
  if (value === undefined || value.length === 0) {
    throw new AppError("validation_failed", `${name} is required`);
  }
  return value;
}

function listQuery(request: FastifyRequest): ListQuery {
  const query = request.query as Record<string, unknown>;
  const parsed: ListQuery = { limit: parseLimit(query.limit) };
  const cursor = queryString(query.cursor);
  const projectId = queryString(query.projectId);
  const taskId = queryString(query.taskId);
  const runId = queryString(query.runId);
  const status = queryString(query.status);
  if (cursor !== undefined) parsed.cursor = cursor;
  if (projectId !== undefined) parsed.projectId = projectId;
  if (taskId !== undefined) parsed.taskId = taskId;
  if (runId !== undefined) parsed.runId = runId;
  if (status !== undefined) parsed.status = status;
  return parsed;
}

function sendDto(reply: FastifyReply, status: number, body: unknown, revision?: number): void {
  if (revision !== undefined) {
    void reply.header("etag", `"${revision}"`);
  }
  void reply.code(status).send(body);
}

function requireFound<T>(value: T | null, message: string): T {
  if (value === null) {
    throw new AppError("not_found", message);
  }
  return value;
}

function commandDeps(request: FastifyRequest, deps: RouteDeps) {
  const session = request.session;
  if (!session) {
    throw new AppError("unauthenticated", "Session is required");
  }
  return {
    session,
    receipts: deps.receipts,
    services: deps.services,
    ids: deps.ids,
    now: deps.now,
  };
}

type CommandFn = (
  request: FastifyRequest,
  reply: FastifyReply,
  spec: CommandSpec,
  run: (
    ctx: CommandContext,
    body: Record<string, unknown>,
  ) => CommandOutcome | Promise<CommandOutcome>,
) => Promise<void>;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const cmd: CommandFn = (request, reply, spec, run) =>
    executeCommand(request, reply, commandDeps(request, deps), spec, run);

  app.get("/api/v1/capabilities", async () => deps.services.capabilities());
  app.get("/capabilities", async () => deps.services.capabilities());

  app.get("/api/v1/operations/:operationId", async (request) => {
    const session = request.session;
    if (!session) {
      throw new AppError("unauthenticated", "Session is required");
    }
    const operationId = param(request, "operationId");
    const stored = deps.receipts.getByOperationId(operationId);
    if (stored && stored.receipt.scope.principalId === session.principalId) {
      return stored.receipt;
    }
    const receipt = deps.services.getOperation(operationId, session.principalId);
    return requireFound(receipt, `Operation ${operationId} not found`);
  });

  app.post("/api/v1/projects", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /projects",
        resource: () => "projects",
        requireIfMatch: false,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["name", "objective", "operationId"]);
        return deps.services.createProject(ctx, {
          name: requiredString(body, "name"),
          objective: requiredString(body, "objective"),
        });
      },
    );
  });

  app.get("/api/v1/projects", async (request) => deps.services.listProjects(listQuery(request)));

  app.get("/api/v1/teams", async (request) => deps.services.listTeams(listQuery(request)));
  app.get("/api/v1/teams/:id/versions/:versionId", async (request) =>
    requireFound(
      deps.services.getTeamVersion(param(request, "id"), param(request, "versionId")),
      "Team version not found",
    ),
  );
  app.get("/api/v1/teams/:id", async (request) =>
    requireFound(deps.services.getTeam(param(request, "id")), "Team not found"),
  );
  registerCatalogWrites(app, cmd, deps);
  app.get("/api/v1/workflows", async (request) => deps.services.listWorkflows(listQuery(request)));
  app.get("/api/v1/workflows/:id/versions/:versionId", async (request) =>
    requireFound(
      deps.services.getWorkflowVersion(param(request, "id"), param(request, "versionId")),
      "Workflow version not found",
    ),
  );
  app.get("/api/v1/workflows/:id", async (request) =>
    requireFound(deps.services.getWorkflow(param(request, "id")), "Workflow not found"),
  );
  app.get("/api/v1/nodes", async (request) => deps.services.listNodes(listQuery(request)));
  app.get("/api/v1/nodes/:id", async (request) =>
    requireFound(deps.services.getNode(param(request, "id")), "Node not found"),
  );
  app.get("/api/v1/runtimes", async (request) => deps.services.listRuntimes(listQuery(request)));
  app.get("/api/v1/runtimes/:id", async (request) =>
    requireFound(deps.services.getRuntime(param(request, "id")), "Runtime not found"),
  );
  app.get("/api/v1/runtimes/:id/capabilities", async (request) =>
    requireFound(deps.services.getRuntimeCapabilities(param(request, "id")), "Runtime not found"),
  );

  app.get("/api/v1/projects/:id", async (request, reply) => {
    const project = requireFound(
      deps.services.getProject(param(request, "id")),
      "Project not found",
    );
    sendDto(reply, 200, project, project.stateRevision);
  });

  app.get("/api/v1/projects/:id/budget", async (request) =>
    requireFound(deps.services.getProjectBudget(param(request, "id")), "Project not found"),
  );

  app.post("/api/v1/projects/:id/workspaces", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /projects/{id}/workspaces",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["authorizationRef", "operationId"]);
        return deps.services.createProjectWorkspace(ctx, param(request, "id"), {
          authorizationRef: requiredString(body, "authorizationRef"),
        });
      },
    );
  });

  app.patch("/api/v1/projects/:id", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "PATCH /projects/{id}",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["name", "objective", "teamVersionId", "operationId"]);
        const input: { name?: string; objective?: string; teamVersionId?: string } = {};
        const name = optionalString(body, "name");
        const objective = optionalString(body, "objective");
        const teamVersionId = optionalString(body, "teamVersionId");
        if (name !== undefined) input.name = name;
        if (objective !== undefined) input.objective = objective;
        if (teamVersionId !== undefined) input.teamVersionId = teamVersionId;
        return deps.services.patchProject(ctx, param(request, "id"), input);
      },
    );
  });

  registerProjectCommand(app, cmd, "start-planning", (ctx, id, body) => {
    rejectUnknownFields(body, ["operationId"]);
    return deps.services.startPlanning(ctx, id);
  });
  registerProjectCommand(app, cmd, "confirm-plan", (ctx, id, body) => {
    rejectUnknownFields(body, ["planArtifactVersionId", "operationId"]);
    return deps.services.confirmPlan(ctx, id, {
      planArtifactVersionId: requiredString(body, "planArtifactVersionId"),
    });
  });
  registerProjectCommand(app, cmd, "start", (ctx, id, body) => {
    rejectUnknownFields(body, ["operationId", "budgetHardLimitMinor", "orchestrationMode"]);
    const input: {
      budgetHardLimitMinor?: number;
      orchestrationMode?: "workflow_bound" | "direct";
    } = {};
    const budget = optionalInt(body, "budgetHardLimitMinor");
    if (budget !== undefined) input.budgetHardLimitMinor = budget;
    const orchestrationMode = parseStartOrchestrationMode(
      optionalString(body, "orchestrationMode"),
    );
    if (orchestrationMode !== undefined) input.orchestrationMode = orchestrationMode;
    return deps.services.startProject(ctx, id, input);
  });
  registerProjectCommand(app, cmd, "export", (ctx, id, body) => {
    rejectUnknownFields(body, ["operationId"]);
    return deps.services.exportProject(ctx, id);
  });
  registerProjectCommand(app, cmd, "cancel", (ctx, id, body) => {
    rejectUnknownFields(body, ["reason", "mode", "operationId"]);
    const input: { reason?: string; mode?: string } = {};
    const reason = optionalString(body, "reason");
    const mode = optionalString(body, "mode");
    if (reason !== undefined) input.reason = reason;
    if (mode !== undefined) input.mode = mode;
    return deps.services.cancelProject(ctx, id, input);
  });

  app.get("/api/v1/tasks", async (request) => deps.services.listTasks(listQuery(request)));
  app.get("/api/v1/tasks/:id", async (request, reply) => {
    const task = requireFound(deps.services.getTask(param(request, "id")), "Task not found");
    sendDto(reply, 200, task, task.stateRevision);
  });

  app.post(commandRoute("tasks", "retry"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /tasks/{id}:retry",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["operationId"]);
        return deps.services.retryTask(ctx, param(request, "id"));
      },
    );
  });

  app.post(commandRoute("tasks", "cancel"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /tasks/{id}:cancel",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["reason", "mode", "operationId"]);
        const input: { reason?: string; mode?: string } = {};
        const reason = optionalString(body, "reason");
        const mode = optionalString(body, "mode");
        if (reason !== undefined) input.reason = reason;
        if (mode !== undefined) input.mode = mode;
        return deps.services.cancelTask(ctx, param(request, "id"), input);
      },
    );
  });

  app.get("/api/v1/runs", async (request) => deps.services.listRuns(listQuery(request)));
  app.get("/api/v1/runs/:id", async (request, reply) => {
    const run = requireFound(deps.services.getRun(param(request, "id")), "Run not found");
    sendDto(reply, 200, run, run.stateRevision);
  });

  app.post(commandRoute("runs", "pause"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /runs/{id}:pause",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["operationId"]);
        return deps.services.pauseRun(ctx, param(request, "id"));
      },
    );
  });

  app.post(commandRoute("runs", "cancel"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /runs/{id}:cancel",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["reason", "mode", "operationId"]);
        const input: { reason?: string; mode?: string } = {};
        const reason = optionalString(body, "reason");
        const mode = optionalString(body, "mode");
        if (reason !== undefined) input.reason = reason;
        if (mode !== undefined) input.mode = mode;
        return deps.services.cancelRun(ctx, param(request, "id"), input);
      },
    );
  });

  app.post(commandRoute("runs", "input"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /runs/{id}:input",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["text", "payload", "operationId"]);
        const input: { text?: string; payload?: Record<string, unknown> } = {};
        const text = optionalString(body, "text");
        if (text !== undefined) input.text = text;
        if (body.payload !== undefined) {
          if (
            typeof body.payload !== "object" ||
            body.payload === null ||
            Array.isArray(body.payload)
          ) {
            throw new AppError("validation_failed", "payload must be an object");
          }
          input.payload = body.payload as Record<string, unknown>;
        }
        return deps.services.sendRunInput(ctx, param(request, "id"), input);
      },
    );
  });

  app.get("/api/v1/runs/:id/events", async (request) => {
    const query = request.query as Record<string, unknown>;
    return deps.services.listRunEvents(param(request, "id"), {
      limit: parseLimit(query.limit),
      afterIngestionPosition: 0,
      runId: param(request, "id"),
    });
  });

  app.get("/api/v1/approvals", async (request) => deps.services.listApprovals(listQuery(request)));
  app.get("/api/v1/approvals/:id", async (request, reply) => {
    const approval = requireFound(
      deps.services.getApproval(param(request, "id")),
      "Approval not found",
    );
    sendDto(reply, 200, approval, approval.stateRevision);
  });

  registerApprovalCommand(app, deps, cmd, "approve");
  registerApprovalCommand(app, deps, cmd, "reject");
  registerApprovalCommand(app, deps, cmd, "request-changes");

  app.get("/api/v1/artifacts", async (request) => deps.services.listArtifacts(listQuery(request)));
  app.get("/api/v1/artifacts/:id", async (request) =>
    requireFound(deps.services.getArtifact(param(request, "id")), "Artifact not found"),
  );
  app.get("/api/v1/artifacts/:id/versions/:versionId", async (request) =>
    requireFound(
      deps.services.getArtifactVersion(param(request, "id"), param(request, "versionId")),
      "Artifact version not found",
    ),
  );
  app.get("/api/v1/artifacts/:id/versions/:versionId/content", async (request, reply) => {
    const content = requireFound(
      deps.services.readArtifactContent(param(request, "id"), param(request, "versionId")),
      "Artifact version not found",
    );
    void reply
      .header("content-type", content.mediaType)
      .header("x-content-type-options", "nosniff")
      .send(Buffer.from(content.body));
  });
  app.get("/api/v1/artifacts/:id/versions/:versionId/lineage", async (request) =>
    requireFound(
      deps.services.getArtifactLineage(param(request, "id"), param(request, "versionId")),
      "Artifact version not found",
    ),
  );

  app.get("/api/v1/events", async (request) => {
    const query = request.query as Record<string, unknown>;
    const types = queryStringList(query.types);
    const eventQuery: Parameters<AppServices["listEvents"]>[0] = {
      limit: parseLimit(query.limit),
      afterIngestionPosition: Number(queryString(query.after) ?? "0") || 0,
    };
    const projectId = queryString(query.projectId);
    const runId = queryString(query.runId);
    if (projectId !== undefined) eventQuery.projectId = projectId;
    if (runId !== undefined) eventQuery.runId = runId;
    if (types !== undefined) eventQuery.types = types;
    return deps.services.listEvents(eventQuery);
  });

  app.post("/api/v1/session", async (request, reply) => {
    const body = asObject(request.body, true);
    rejectUnknownFields(body, ["bootstrapToken"]);
    const bootstrap = optionalString(body, "bootstrapToken");
    if (request.session) {
      const rotated = deps.sessions.rotate();
      return { sessionToken: rotated.token, principalId: rotated.principalId };
    }
    if (bootstrap === undefined || bootstrap !== request.bootstrapToken) {
      throw new AppError("unauthenticated", "Valid bootstrapToken is required");
    }
    const current = deps.sessions.getCurrent();
    void reply;
    return { sessionToken: current.token, principalId: current.principalId };
  });
}

function withoutOperationId(body: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...body };
  delete rest.operationId;
  return rest;
}

function parseProtocol<T>(parse: (input: unknown) => T, body: Record<string, unknown>): T {
  try {
    return parse(withoutOperationId(body));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Request body failed schema validation";
    throw new AppError("validation_failed", message);
  }
}

function registerCatalogWrites(app: FastifyInstance, cmd: CommandFn, deps: RouteDeps): void {
  app.post("/api/v1/workflows", async (request, reply) => {
    await cmd(
      request,
      reply,
      { canonicalOperation: "POST /workflows", resource: () => "workflows", requireIfMatch: false },
      (ctx, body) =>
        deps.services.createWorkflow(ctx, parseProtocol(parseCreateWorkflowInput, body)),
    );
  });
  app.patch("/api/v1/workflows/:id", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "PATCH /workflows/{id}",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.patchWorkflow(
          ctx,
          param(request, "id"),
          parseProtocol(parsePatchWorkflowInput, body),
        ),
    );
  });
  app.post("/api/v1/workflows/:id/versions", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /workflows/{id}/versions",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.createWorkflowVersion(
          ctx,
          param(request, "id"),
          parseProtocol(parseWorkflowVersionWrite, body),
        ),
    );
  });
  app.patch("/api/v1/workflows/:id/versions/:versionId", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "PATCH /workflows/{id}/versions/{versionId}",
        resource: (req) => `${param(req, "id")}/versions/${param(req, "versionId")}`,
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.patchWorkflowVersion(
          ctx,
          param(request, "id"),
          param(request, "versionId"),
          parseProtocol(parseWorkflowVersionWrite, body),
        ),
    );
  });
  app.post(nestedVersionCommandRoute("workflows", "publish"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /workflows/{id}/versions/{versionId}:publish",
        resource: (req) => `${param(req, "id")}/versions/${param(req, "versionId")}`,
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["operationId"]);
        return deps.services.publishWorkflowVersion(
          ctx,
          param(request, "id"),
          param(request, "versionId"),
        );
      },
    );
  });

  app.post("/api/v1/teams", async (request, reply) => {
    await cmd(
      request,
      reply,
      { canonicalOperation: "POST /teams", resource: () => "teams", requireIfMatch: false },
      (ctx, body) => deps.services.createTeam(ctx, parseProtocol(parseCreateTeamInput, body)),
    );
  });
  app.patch("/api/v1/teams/:id", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "PATCH /teams/{id}",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.patchTeam(
          ctx,
          param(request, "id"),
          parseProtocol(parsePatchTeamInput, body),
        ),
    );
  });
  app.post("/api/v1/teams/:id/versions", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /teams/{id}/versions",
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.createTeamVersion(
          ctx,
          param(request, "id"),
          parseProtocol(parseTeamVersionWrite, body),
        ),
    );
  });
  app.patch("/api/v1/teams/:id/versions/:versionId", async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "PATCH /teams/{id}/versions/{versionId}",
        resource: (req) => `${param(req, "id")}/versions/${param(req, "versionId")}`,
        requireIfMatch: true,
      },
      (ctx, body) =>
        deps.services.patchTeamVersion(
          ctx,
          param(request, "id"),
          param(request, "versionId"),
          parseProtocol(parseTeamVersionWrite, body),
        ),
    );
  });
  app.post(nestedVersionCommandRoute("teams", "publish"), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: "POST /teams/{id}/versions/{versionId}:publish",
        resource: (req) => `${param(req, "id")}/versions/${param(req, "versionId")}`,
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, ["operationId"]);
        return deps.services.publishTeamVersion(
          ctx,
          param(request, "id"),
          param(request, "versionId"),
        );
      },
    );
  });
}

function registerProjectCommand(
  app: FastifyInstance,
  cmd: CommandFn,
  action: string,
  run: (
    ctx: CommandContext,
    id: string,
    body: Record<string, unknown>,
  ) => CommandOutcome | Promise<CommandOutcome>,
): void {
  app.post(commandRoute("projects", action), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: `POST /projects/{id}:${action}`,
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => run(ctx, param(request, "id"), body),
    );
  });
}

function registerApprovalCommand(
  app: FastifyInstance,
  deps: RouteDeps,
  cmd: CommandFn,
  action: "approve" | "reject" | "request-changes",
): void {
  app.post(commandRoute("approvals", action), async (request, reply) => {
    await cmd(
      request,
      reply,
      {
        canonicalOperation: `POST /approvals/{id}:${action}`,
        resource: (req) => param(req, "id"),
        requireIfMatch: true,
      },
      (ctx, body) => {
        rejectUnknownFields(body, [
          "decisionReason",
          "digest",
          "artifactVersionId",
          "requestedChanges",
          "operationId",
        ]);
        const input: {
          decisionReason: string;
          digest?: string;
          artifactVersionId?: string;
          requestedChanges?: Array<{ criterionId: string; instruction: string }>;
        } = { decisionReason: requiredString(body, "decisionReason") };
        const digest = optionalString(body, "digest");
        const artifactVersionId = optionalString(body, "artifactVersionId");
        if (digest !== undefined) input.digest = digest;
        if (artifactVersionId !== undefined) input.artifactVersionId = artifactVersionId;
        if (body.requestedChanges !== undefined) {
          if (!Array.isArray(body.requestedChanges)) {
            throw new AppError("validation_failed", "requestedChanges must be an array");
          }
          input.requestedChanges = body.requestedChanges.map((item) => {
            const row = asObject(item, false);
            rejectUnknownFields(row, ["criterionId", "instruction"]);
            return {
              criterionId: requiredString(row, "criterionId"),
              instruction: requiredString(row, "instruction"),
            };
          });
        }
        if (action === "approve") return deps.services.approve(ctx, param(request, "id"), input);
        if (action === "reject") return deps.services.reject(ctx, param(request, "id"), input);
        return deps.services.requestChanges(ctx, param(request, "id"), input);
      },
    );
  });
}
