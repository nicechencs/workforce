import { assertSafePath } from "./paths.js";

export interface TransportRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ClientTransport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

export interface LoopbackTransportOptions {
  port: number;
  getSessionToken: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export function createLoopbackTransport(options: LoopbackTransportOptions): ClientTransport {
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("invalid loopback port");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async request(req: TransportRequest): Promise<TransportResponse> {
      const path = assertSafePath(req.path);
      const headers = new Headers(req.headers);
      const token = options.getSessionToken();
      if (token !== undefined && token.length > 0 && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      if (req.method !== "GET" && req.body !== undefined && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const url = `http://127.0.0.1:${options.port}${path}`;
      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.body !== undefined) {
        init.body = JSON.stringify(req.body);
      }
      const res = await fetchImpl(url, init);
      const headerMap: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headerMap[key] = value;
      });
      const contentType = res.headers.get("content-type") ?? "";
      let body: unknown;
      if (
        contentType.includes("application/json") ||
        contentType.includes("application/problem+json")
      ) {
        const text = await res.text();
        body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
      } else if (contentType.includes("text/")) {
        body = await res.text();
      } else {
        body = new Uint8Array(await res.arrayBuffer());
      }
      return { status: res.status, headers: headerMap, body };
    },
  };
}
