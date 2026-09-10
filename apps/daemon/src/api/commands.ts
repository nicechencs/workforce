import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReceiptScope } from "@workforce/protocol";

import { canonicalJson, sha256Hex } from "../modules/digest.js";
import { AppError } from "../modules/errors.js";
import { prefixes, type IdFactory } from "../modules/ids.js";
import type { AppServices, CommandContext } from "../modules/index.js";
import type { MemoryReceiptStore, StoredReceipt } from "../modules/receipts.js";
import { asObject, optionalString, parseIfMatch, requireIfMatch } from "./body.js";
import type { Session } from "./auth.js";

export interface CommandSpec {
  canonicalOperation: string;
  resource: (request: FastifyRequest) => string;
  requireIfMatch: boolean;
}

export interface CommandOutcome {
  status: number;
  body: unknown;
  revision?: number;
}

export function requestDigest(input: {
  method: string;
  url: string;
  body: unknown;
  ifMatch: string | undefined;
}): string {
  return sha256Hex(
    canonicalJson({
      method: input.method,
      url: input.url,
      body: input.body ?? {},
      ifMatch: input.ifMatch ?? null,
    }),
  );
}

export async function executeCommand(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: {
    session: Session;
    receipts: MemoryReceiptStore;
    services: AppServices;
    ids: IdFactory;
    now: () => Date;
  },
  spec: CommandSpec,
  run: (
    ctx: CommandContext,
    body: Record<string, unknown>,
  ) => CommandOutcome | Promise<CommandOutcome>,
): Promise<void> {
  const keyHeader = request.headers["idempotency-key"];
  const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  if (idempotencyKey === undefined || idempotencyKey.length === 0 || idempotencyKey.length > 256) {
    throw new AppError("validation_failed", "Idempotency-Key is required");
  }

  const ifMatchHeader = request.headers["if-match"];
  const ifMatchRaw = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
  const ifMatch = spec.requireIfMatch ? requireIfMatch(ifMatchHeader) : parseIfMatch(ifMatchHeader);
  const body = asObject(request.body, true);
  const digest = requestDigest({
    method: request.method,
    url: request.routeOptions.url ?? request.url,
    body,
    ifMatch: ifMatchRaw,
  });
  const resource = spec.resource(request);
  const scope: ReceiptScope = {
    principalId: deps.session.principalId,
    clientId: deps.session.clientId,
    canonicalOperation: spec.canonicalOperation,
    resource,
    idempotencyKey,
  };
  const existing = deps.receipts.get(scope);
  if (existing) {
    if (existing.receipt.requestDigest !== digest) {
      throw new AppError(
        "idempotency_key_reused",
        "Idempotency-Key was reused with a different payload",
      );
    }
    if (existing.etag !== undefined) {
      void reply.header("etag", `"${existing.etag}"`);
    }
    void reply.code(existing.httpStatus).send(existing.body);
    return;
  }

  const operationId = optionalString(body, "operationId") ?? deps.ids(prefixes.operation);
  const ctx: CommandContext = {
    principalId: deps.session.principalId,
    clientId: deps.session.clientId,
    operationId,
  };
  if (ifMatch !== undefined) {
    ctx.ifMatch = ifMatch;
  }
  const result = await run(ctx, body);
  const acceptedAt = deps.now().toISOString();
  const stored: StoredReceipt = {
    receipt: {
      operationId,
      status: "committed",
      scope,
      requestDigest: digest,
      acceptedAt,
      result: result.body,
    },
    httpStatus: result.status,
    body: result.body,
  };
  if (result.revision !== undefined) {
    stored.etag = String(result.revision);
  }
  deps.receipts.put(stored);
  deps.services.rememberOperation(stored.receipt);
  if (stored.etag !== undefined) {
    void reply.header("etag", `"${stored.etag}"`);
  }
  void reply.code(result.status).send(result.body);
}
