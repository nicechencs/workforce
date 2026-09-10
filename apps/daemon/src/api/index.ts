import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import "./fastify-augment.js";

import type { AppServices } from "../modules/index.js";
import type { IdFactory } from "../modules/ids.js";
import { AppError } from "../modules/errors.js";
import type { MemoryReceiptStore } from "../modules/receipts.js";
import { parseBearer, type SessionRegistry } from "./auth.js";
import { rejectSecretQuery } from "./body.js";
import { mapError, problemFromCode, sendProblem } from "./problem.js";
import { rewriteCommandPath } from "./rewrite.js";
import { registerRoutes } from "./routes.js";
import { registerSse, type SseOptions } from "./sse.js";

export interface DaemonApiOptions {
  services: AppServices;
  receipts: MemoryReceiptStore;
  sessions: SessionRegistry;
  ids: IdFactory;
  now: () => Date;
  protocolVersion: string;
  pid: number;
  startIdentity: string;
  bootstrapToken: string;
  sse: SseOptions;
  getPort: () => number;
}

const PUBLIC_PATHS = new Set([
  "/health",
  "/ready",
  "/version",
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/version",
]);

function pathnameOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return false;
  }
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return allowed.has(hostHeader.toLowerCase());
}

function originAllowed(origin: string | undefined, port: number): boolean {
  if (
    origin === undefined ||
    origin === "null" ||
    origin === "file://" ||
    origin.startsWith("file:")
  ) {
    return true;
  }
  if (origin.startsWith("app://") || origin.startsWith("workforce://")) {
    return true;
  }
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  return allowed.has(origin.toLowerCase());
}

export function buildApi(options: DaemonApiOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    return503OnClosing: true,
    routerOptions: { ignoreTrailingSlash: true },
    rewriteUrl: (req) => rewriteCommandPath(req.url ?? "/"),
    genReqId: () => `req_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
  });

  app.addHook("onRequest", async (request, reply) => {
    rejectSecretQuery(request.url);
    const port = options.getPort();
    if (port > 0 && !hostAllowed(request.headers.host, port)) {
      sendProblem(reply, problemFromCode("forbidden", "Host is not a loopback listener", request));
      return reply;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !originAllowed(origin, port)) {
      sendProblem(reply, problemFromCode("forbidden", "Origin is not trusted", request));
      return reply;
    }
    void reply.header("workforce-api-version", options.protocolVersion);
    void reply.header("x-request-id", request.id);

    const path = pathnameOf(request.url);
    if (PUBLIC_PATHS.has(path)) {
      return;
    }
    if (request.method === "POST" && path === "/api/v1/session") {
      request.bootstrapToken = options.bootstrapToken;
      const bearer = parseBearer(request.headers.authorization);
      if (bearer) {
        const session = options.sessions.resolve(bearer);
        if (session) {
          request.session = session;
        }
      }
      return;
    }
    const token = parseBearer(request.headers.authorization);
    if (!token) {
      sendProblem(
        reply,
        problemFromCode("unauthenticated", "Authorization Bearer token is required", request),
      );
      return reply;
    }
    const session = options.sessions.resolve(token);
    if (!session) {
      sendProblem(reply, problemFromCode("unauthenticated", "Session token is invalid", request));
      return reply;
    }
    request.session = session;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      sendProblem(reply, mapError(error, request));
      return;
    }
    const mapped = mapError(error, request);
    if (mapped.code === "validation_failed" && !(error instanceof AppError)) {
      const status =
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      if (status >= 500) {
        sendProblem(reply, {
          type: "urn:workforce:error:internal",
          title: "Internal error",
          status: 500,
          code: "validation_failed",
          detail: "Internal error",
          instance: pathnameOf(request.url),
          requestId: request.id,
          retryable: true,
        });
        return;
      }
    }
    sendProblem(reply, mapped);
  });

  app.setNotFoundHandler((request, reply) => {
    sendProblem(reply, problemFromCode("not_found", "No such endpoint", request));
  });

  const health = () => ({
    ok: true as const,
    pid: options.pid,
    port: options.getPort(),
    startIdentity: options.startIdentity,
    protocolVersion: options.protocolVersion,
  });
  const version = () => ({
    protocolVersion: options.protocolVersion,
    apiVersion: "v1",
  });
  const ready = () => ({
    ready: true,
    checks: { api: true },
  });

  app.get("/health", async () => health());
  app.get("/version", async () => version());
  app.get("/ready", async () => ready());
  app.get("/api/v1/health", async () => health());
  app.get("/api/v1/version", async () => version());
  app.get("/api/v1/ready", async () => ready());

  registerRoutes(app, {
    services: options.services,
    receipts: options.receipts,
    sessions: options.sessions,
    ids: options.ids,
    now: options.now,
  });
  registerSse(app, options.services, options.sse);

  return app;
}

export type { FastifyRequest };
