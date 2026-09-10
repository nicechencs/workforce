import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { acquireExclusiveListen, closeServer } from "../src/main/daemon-supervisor/lock.js";

describe("single-instance exclusive listen", () => {
  const servers: net.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  it("rejects a second exclusive bind on the same loopback port", async () => {
    const first = await acquireExclusiveListen({ kind: "tcp", host: "127.0.0.1", port: 0 });
    servers.push(first);
    const address = first.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }
    await expect(
      acquireExclusiveListen({ kind: "tcp", host: "127.0.0.1", port: address.port }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
