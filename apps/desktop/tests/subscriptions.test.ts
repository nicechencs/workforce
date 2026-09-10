import { describe, expect, it } from "vitest";

import { EventSubscriptionHub } from "../src/main/ipc/subscriptions.js";

describe("event subscriptions", () => {
  it("reuses the same live subscription for the same cursor and filter", () => {
    const hub = new EventSubscriptionHub();
    const first = hub.subscribe({ cursor: "10", types: ["run.status_changed"] });
    const second = hub.subscribe({ cursor: "10", types: ["run.status_changed"] });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.subscription.subscriptionId).toBe(first.subscription.subscriptionId);
    expect(hub.size).toBe(1);
  });
});
