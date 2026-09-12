import { protocolError, type ProtocolError } from "@workforce/protocol";

export interface ExplicitTargetMerge {
  projectId: string;
  contentDigest: string;
  targetBranch: string;
  principalId: string;
  explicitAuthorization: true;
}

export interface TargetMergeIntent {
  mode: "local_intent_only";
  targetBranch: string;
  contentDigest: string;
  principalId: string;
  pushed: false;
  pullRequestCreated: false;
}

export type RecordTargetMergeResult =
  { ok: true; intent: TargetMergeIntent } | { ok: false; error: ProtocolError };

export function recordTargetMergeIntent(command: ExplicitTargetMerge): RecordTargetMergeResult {
  if (command.explicitAuthorization !== true) {
    return {
      ok: false,
      error: protocolError("forbidden", "target-branch merge requires explicit authorization"),
    };
  }
  if (!command.targetBranch || !command.contentDigest) {
    return {
      ok: false,
      error: protocolError("validation_failed", "targetBranch and contentDigest are required"),
    };
  }
  return {
    ok: true,
    intent: {
      mode: "local_intent_only",
      targetBranch: command.targetBranch,
      contentDigest: command.contentDigest,
      principalId: command.principalId,
      pushed: false,
      pullRequestCreated: false,
    },
  };
}

/** Merge intent is only valid for the current integrated digest. */
export function bindTargetMergeToDigest(
  command: ExplicitTargetMerge,
  currentDigest: string,
): RecordTargetMergeResult {
  if (command.contentDigest !== currentDigest) {
    return {
      ok: false,
      error: protocolError(
        "conflict",
        "target-branch merge digest does not match current integration",
        { details: { expected: currentDigest, provided: command.contentDigest } },
      ),
    };
  }
  return recordTargetMergeIntent(command);
}
