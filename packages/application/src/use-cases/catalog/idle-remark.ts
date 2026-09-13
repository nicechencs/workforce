import { workerCardFieldsAreImmutable } from "@workforce/protocol";
import type {
  ForkWorkerVersionAcceptedDto,
  WorkerCardFieldName,
  WorkerDraftDto,
  WorkerDraftWrite,
  WorkerDto,
} from "@workforce/protocol";

import { invalidTransition, notFound } from "../projects/errors.js";
import type { CatalogService } from "./service.js";

/**
 * Idle talk writes one printable card slot via existing draft PATCH / fork.
 * Not a Task, not a Run, not IM, and not a new HTTP resource.
 */
export interface ApplyIdleWorkerRemarkInput {
  workerId: string;
  workerDraftId?: string;
  workerVersionId?: string;
  cardField: WorkerCardFieldName;
  text?: string;
}

export interface IdleWorkerRemarkResult {
  worker: WorkerDto;
  draft: WorkerDraftDto;
  forkedFromWorkerVersionId?: string;
}

/**
 * Open draft → PATCH that slot. Published + immutable (including TeamVersion
 * references) → fork a new identity, copy source card fields, then PATCH the
 * new draft. The source WorkerVersion is not mutated.
 */
export function applyIdleWorkerRemark(
  catalog: CatalogService,
  input: ApplyIdleWorkerRemarkInput,
): IdleWorkerRemarkResult {
  const worker = catalog.getWorker(input.workerId);
  if (!worker) {
    throw notFound("worker", input.workerId);
  }

  const write: WorkerDraftWrite = {
    [input.cardField]: input.text ?? "",
  };

  if (input.workerDraftId !== undefined) {
    const draft = catalog.patchWorkerDraft(input.workerId, input.workerDraftId, write);
    return { worker, draft };
  }

  const openDraft = catalog.catalog.findWorkerDraftByWorker(input.workerId);
  if (openDraft) {
    const draft = catalog.patchWorkerDraft(input.workerId, openDraft.id, write);
    return { worker, draft };
  }

  const versionId = input.workerVersionId ?? worker.activeVersionId;
  if (versionId === undefined) {
    throw invalidTransition(
      "idle remark requires an open draft or a published WorkerVersion to fork",
    );
  }
  const source = catalog.getWorkerVersion(input.workerId, versionId);
  if (!source) {
    throw notFound("worker version", versionId);
  }
  if (!workerCardFieldsAreImmutable(source)) {
    throw invalidTransition(
      "idle remark requires an open draft or a published WorkerVersion to fork",
    );
  }

  const forked: ForkWorkerVersionAcceptedDto = catalog.forkWorkerVersion(input.workerId, source.id);
  const draft = catalog.patchWorkerDraft(forked.workerId, forked.workerDraftId, write);
  const created = catalog.getWorker(forked.workerId);
  if (!created) {
    throw notFound("worker", forked.workerId);
  }
  return {
    worker: created,
    draft,
    forkedFromWorkerVersionId: forked.forkedFromWorkerVersionId,
  };
}
