import {
  decodeSseCursor,
  encodeSseCursor,
  protocolError,
  type WorkforceEvent,
} from "@workforce/protocol";

import {
  highWaterMark,
  trimHorizon,
  SqliteEventStore,
  type EventReadQuery,
} from "../store/index.js";
import type { SqliteQueryable } from "../store/session.js";

export type { EventReadQuery };

export class EventCursorExpired extends Error {
  readonly code = "event_cursor_expired" as const;
  readonly protocol = protocolError(
    "event_cursor_expired",
    "SSE cursor is invalid or filter no longer matches",
  );

  constructor(message = "SSE cursor expired") {
    super(message);
    this.name = "EventCursorExpired";
  }
}

export function cursorFilterDigest(
  query: Pick<EventReadQuery, "stream" | "types" | "projectId">,
): string {
  return JSON.stringify({
    stream: query.stream ?? null,
    types: query.types ?? null,
    projectId: query.projectId ?? null,
  });
}

export function encodeSubscriptionCursor(
  ingestionPosition: number,
  query: Pick<EventReadQuery, "stream" | "types" | "projectId">,
): string {
  return encodeSseCursor({
    ingestionPosition,
    filterDigest: cursorFilterDigest(query),
  });
}

export function decodeSubscriptionCursor(
  raw: string,
  query: Pick<EventReadQuery, "stream" | "types" | "projectId">,
): number {
  let cursor;
  try {
    cursor = decodeSseCursor(raw);
  } catch {
    throw new EventCursorExpired("SSE cursor could not be parsed");
  }
  if (cursor.filterDigest !== cursorFilterDigest(query)) {
    throw new EventCursorExpired("SSE cursor filter does not match the subscription");
  }
  return cursor.ingestionPosition;
}

export class SqliteSubscriptionReader {
  private readonly store: SqliteEventStore;

  constructor(private readonly db: SqliteQueryable) {
    this.store = new SqliteEventStore(db);
  }

  highWaterMark(): number {
    return highWaterMark(this.db);
  }

  trimHorizon(): number {
    return trimHorizon(this.db);
  }

  async read(query: EventReadQuery): Promise<WorkforceEvent[]> {
    return this.store.read(query);
  }

  async readAfterCursor(
    rawCursor: string | undefined,
    query: EventReadQuery,
  ): Promise<WorkforceEvent[]> {
    const after =
      rawCursor === undefined
        ? (query.afterIngestionPosition ?? 0)
        : decodeSubscriptionCursor(rawCursor, query);
    if (after < this.trimHorizon()) {
      throw new EventCursorExpired("SSE cursor is older than retained events");
    }
    return this.store.read({ ...query, afterIngestionPosition: after });
  }
}
