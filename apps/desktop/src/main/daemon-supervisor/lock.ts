import net from "node:net";

import { DAEMON_MUTEX_NAME } from "./types.js";

export { DAEMON_MUTEX_NAME };

export type ExclusiveListenTarget =
  { kind: "pipe"; path: string } | { kind: "tcp"; host: "127.0.0.1"; port: number };

export function acquireExclusiveListen(target: ExclusiveListenTarget): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    const listenOptions =
      target.kind === "pipe"
        ? { path: target.path, exclusive: true as const }
        : { host: target.host, port: target.port, exclusive: true as const };
    server.listen(listenOptions, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

export async function probeExclusiveListenHeld(target: ExclusiveListenTarget): Promise<boolean> {
  try {
    const server = await acquireExclusiveListen(target);
    await closeServer(server);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EADDRINUSE";
  }
}

export function probeNamedPipe(path: string, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ path });
    const finish = (held: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(held);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

export function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
