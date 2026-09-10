import { ID_PREFIX } from "@workforce/domain";

import type { ApprovalGrant, GrantKey, GrantStore } from "./types.js";

function grantIdentity(key: GrantKey): string {
  return [
    key.actionType,
    key.digest,
    key.resource,
    key.version ?? "",
    key.principalId,
    key.policyVersion,
  ].join("\u0000");
}

function cloneGrant(grant: ApprovalGrant): ApprovalGrant {
  const copy: ApprovalGrant = {
    id: grant.id,
    actionType: grant.actionType,
    digest: grant.digest,
    resource: grant.resource,
    principalId: grant.principalId,
    policyVersion: grant.policyVersion,
    gate: grant.gate,
    expiresAt: grant.expiresAt,
  };
  if (grant.version !== undefined) {
    copy.version = grant.version;
  }
  if (grant.consumedAt !== undefined) {
    copy.consumedAt = grant.consumedAt;
  }
  return copy;
}

/** In-memory fake. Durable approval records belong to T04/T09. */
export class InMemoryGrantStore implements GrantStore {
  private readonly byId = new Map<string, ApprovalGrant>();
  private seq = 0;

  nextId(): string {
    this.seq += 1;
    return `${ID_PREFIX.approval}${String(this.seq).padStart(4, "0")}`;
  }

  async put(grant: ApprovalGrant): Promise<void> {
    this.byId.set(grant.id, cloneGrant(grant));
  }

  async find(key: GrantKey): Promise<ApprovalGrant | undefined> {
    const identity = grantIdentity(key);
    for (const grant of this.byId.values()) {
      if (grantIdentity(grant) === identity) {
        return cloneGrant(grant);
      }
    }
    return undefined;
  }

  async consume(id: string, consumedAt: string): Promise<boolean> {
    const grant = this.byId.get(id);
    if (!grant || grant.consumedAt !== undefined) {
      return false;
    }
    grant.consumedAt = consumedAt;
    return true;
  }
}
