import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  EventCursorExpired,
  cursorFilterDigest,
  decodeSubscriptionCursor,
} from "@workforce/events/subscriptions";
import { encodeSseCursor, type WorkforceEvent } from "@workforce/protocol";

import { AppError } from "../modules/errors.js";
import type { AppServices } from "../modules/index.js";
import { parseLimit, queryString, queryStringList } from "./body.js";

export interface SseOptions {
  heartbeatMs: number;
  pollMs: number;
}

function lastEventId(request: FastifyRequest): string | undefined {
  const header = request.headers["last-event-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const query = queryString((request.query as Record<string, unknown>).cursor);
  return fromHeader ?? query;
}

export function registerSse(
  app: FastifyInstance,
  services: AppServices,
  options: SseOptions,
): void {
  app.get("/api/v1/events/stream", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const projectId = queryString(query.projectId);
    const runId = queryString(query.runId);
    const types = queryStringList(query.types);
    const filter: { projectId?: string; types?: string[]; stream?: string } = {};
    if (projectId !== undefined) filter.projectId = projectId;
    if (types !== undefined) filter.types = types;
    if (runId !== undefined) filter.stream = `run:${runId}`;
    const digest = cursorFilterDigest(filter);
    const rawCursor = lastEventId(request);
    let after = 0;
    if (rawCursor !== undefined) {
      try {
        after = decodeSubscriptionCursor(rawCursor, filter);
        if (after < services.trimHorizon()) {
          throw new EventCursorExpired("SSE cursor is older than retained events");
        }
      } catch (error) {
        if (error instanceof EventCursorExpired || error instanceof AppError) {
          throw error instanceof AppError
            ? error
            : new AppError("event_cursor_expired", error.message);
        }
        throw new AppError("event_cursor_expired", "SSE cursor is invalid or expired");
      }
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "workforce-api-version": "0.1",
      "x-request-id": request.id,
    });

    const send = (event: WorkforceEvent): void => {
      const position = event.ingestionPosition;
      if (position === undefined) {
        return;
      }
      const id = encodeSseCursor({ ingestionPosition: position, filterDigest: digest });
      reply.raw.write(`id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      after = position;
    };

    let flushing = false;
    const flush = (): void => {
      if (flushing) {
        return;
      }
      flushing = true;
      const eventQuery: Parameters<AppServices["listEvents"]>[0] = {
        limit: parseLimit(query.limit, 200),
        afterIngestionPosition: after,
      };
      if (filter.projectId !== undefined) eventQuery.projectId = filter.projectId;
      if (runId !== undefined) eventQuery.runId = runId;
      if (filter.types !== undefined) eventQuery.types = filter.types;
      if (filter.stream !== undefined) eventQuery.stream = filter.stream;
      void Promise.resolve(services.listEvents(eventQuery))
        .then((page) => {
          for (const event of page.items) {
            send(event);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          flushing = false;
        });
    };

    flush();
    const poll = setInterval(flush, options.pollMs);
    const beat = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, options.heartbeatMs);

    const close = (): void => {
      clearInterval(poll);
      clearInterval(beat);
    };
    request.raw.on("close", close);
    reply.raw.on("close", close);
  });
}
