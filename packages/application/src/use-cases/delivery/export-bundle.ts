import { protocolError } from "@workforce/protocol";

import { previousApprovalStillValid, sameDigestBinding } from "./integrate.js";
import type {
  DeliveryExportBundle,
  ExportDeliveryBundleCommand,
  ExportDeliveryBundleResult,
  IntegrationStore,
} from "./ports.js";

export interface ExportDeliveryBundleDeps {
  store: IntegrationStore;
}

/**
 * Exports a traceable delivery bundle for the current integrated digest.
 * Review, evaluation, and human artifact approval must bind that same digest.
 * Never records a push or pull request.
 */
export async function exportDeliveryBundle(
  command: ExportDeliveryBundleCommand,
  deps: ExportDeliveryBundleDeps,
): Promise<ExportDeliveryBundleResult> {
  const records = await deps.store.list(command.projectId, command.workflowVersionId);
  const current = [...records].reverse().find((record) => !record.superseded);
  if (!current) {
    return {
      ok: false,
      error: protocolError("not_found", "no integration record for this workflow version"),
    };
  }
  if (current.outcome.status !== "integrated") {
    return {
      ok: false,
      error: protocolError("invalid_transition", "integration has unresolved conflicts", {
        details: {
          nodeId: current.outcome.conflict.nodeId,
          requiresHuman: true,
        },
      }),
    };
  }

  const outcome = current.outcome;
  if (
    !sameDigestBinding({
      reviewDigest: outcome.reviewBinding.contentDigest,
      acceptanceDigest: outcome.acceptanceBinding.contentDigest,
      evaluationDigest: outcome.evaluationBinding.contentDigest,
    })
  ) {
    return {
      ok: false,
      error: protocolError("conflict", "review, evaluation, and acceptance must share one digest"),
    };
  }
  if (outcome.reviewBinding.contentDigest !== outcome.contentDigest) {
    return {
      ok: false,
      error: protocolError("conflict", "export digest does not match integrated content"),
    };
  }
  if (outcome.pushed || outcome.pullRequestCreated) {
    return {
      ok: false,
      error: protocolError("forbidden", "delivery export must not record push or pull request"),
    };
  }
  if (
    !previousApprovalStillValid({
      approvedDigest: outcome.acceptanceBinding.contentDigest,
      currentDigest: outcome.contentDigest,
    })
  ) {
    return {
      ok: false,
      error: protocolError("conflict", "approval digest no longer matches the integrated result"),
    };
  }

  const bundle: DeliveryExportBundle = {
    projectId: command.projectId,
    workflowVersionId: command.workflowVersionId,
    contentDigest: outcome.contentDigest,
    contributionDigest: current.contributionDigest,
    baseSha: outcome.baseSha,
    workspaceInstanceId: outcome.workspaceInstanceId,
    contributors: outcome.contributors,
    changedPaths: outcome.changedPaths,
    reviewBinding: outcome.reviewBinding,
    acceptanceBinding: outcome.acceptanceBinding,
    evaluationBinding: outcome.evaluationBinding,
    pushed: false,
    pullRequestCreated: false,
  };

  return { ok: true, bundle };
}
