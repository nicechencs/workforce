import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryPolicyEngine, createCanonicalAction } from "@workforce/policy";
import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";

describe("SqliteGrantStore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openDb() {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-grant-"));
    dirs.push(dir);
    return { dir, db: WorkforceSqlite.open(join(dir, "workforce.sqlite")) };
  }

  const grant = {
    id: "apr_grant_1",
    actionType: "git.push",
    digest: "digest-push-1",
    resource: "origin",
    principalId: "usr_alice",
    policyVersion: "0.1.0",
    gate: "action" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };

  it("puts, finds, and consumes a grant by identity", async () => {
    const { db } = openDb();
    try {
      await db.grants.put(grant);
      await expect(
        db.grants.find({
          actionType: grant.actionType,
          digest: grant.digest,
          resource: grant.resource,
          principalId: grant.principalId,
          policyVersion: grant.policyVersion,
        }),
      ).resolves.toEqual(grant);
      await expect(db.grants.consume(grant.id, "2026-09-11T00:00:00.000Z")).resolves.toBe(true);
      await expect(db.grants.consume(grant.id, "2026-09-11T00:00:01.000Z")).resolves.toBe(false);
      await expect(
        db.grants.find({
          actionType: grant.actionType,
          digest: grant.digest,
          resource: grant.resource,
          principalId: grant.principalId,
          policyVersion: grant.policyVersion,
        }),
      ).resolves.toMatchObject({ id: grant.id, consumedAt: "2026-09-11T00:00:00.000Z" });
    } finally {
      db.close();
    }
  });

  it("reloads an unconsumed grant after reopening the same sqlite file", async () => {
    const { dir, db } = openDb();
    const action = createCanonicalAction({
      type: "plan.apply",
      resource: "plan:1",
      version: "arv_plan",
      params: { revision: 3 },
    });
    try {
      const engine = new InMemoryPolicyEngine({
        principalId: "usr_alice",
        grants: db.grants,
      });
      await engine.recordGrant({
        action,
        gate: "plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }

    const reopened = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    try {
      const engine = new InMemoryPolicyEngine({
        principalId: "usr_alice",
        grants: reopened.grants,
      });
      await expect(engine.decide(action)).resolves.toMatchObject({
        decision: "allow",
        reason: "grant_consumed",
      });
      await expect(engine.decide(action)).resolves.toMatchObject({
        decision: "require_approval",
        reason: "grant_consumed",
      });
    } finally {
      reopened.close();
    }
  });

  it("does not let put clear a consumed grant", async () => {
    const { db } = openDb();
    try {
      await db.grants.put(grant);
      await db.grants.consume(grant.id, "2026-09-11T00:00:00.000Z");
      await db.grants.put({
        ...grant,
        id: "apr_grant_2",
        expiresAt: "2099-06-01T00:00:00.000Z",
      });
      await expect(
        db.grants.find({
          actionType: grant.actionType,
          digest: grant.digest,
          resource: grant.resource,
          principalId: grant.principalId,
          policyVersion: grant.policyVersion,
        }),
      ).resolves.toMatchObject({
        id: grant.id,
        consumedAt: "2026-09-11T00:00:00.000Z",
        expiresAt: grant.expiresAt,
      });
    } finally {
      db.close();
    }
  });

  it("keeps deny-always actions closed even when a grant row exists", async () => {
    const { db } = openDb();
    const action = createCanonicalAction({
      type: "credential.copy_env",
      resource: "env",
    });
    try {
      const engine = new InMemoryPolicyEngine({
        principalId: "usr_alice",
        grants: db.grants,
      });
      await engine.recordGrant({
        action,
        gate: "action",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await expect(engine.decide(action)).resolves.toMatchObject({
        decision: "deny",
        reason: "denied:credential.copy_env",
      });
    } finally {
      db.close();
    }
  });
});
