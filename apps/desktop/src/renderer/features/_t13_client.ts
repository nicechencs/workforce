import {
  createDesktopClient,
  DesktopClient,
  ProblemError,
  type ClientTransport,
  type CommandOptions,
  type TransportRequest,
  type TransportResponse,
} from "@workforce/desktop-client";
import type { ApiRequest, ApiResponse, WorkforcePreloadApi } from "@workforce/ui";
import { useEffect, useRef, useState } from "react";

/**
 * T13 typed client: DesktopClient over `window.workforce.api.request`.
 * Tests inject the preload request (or a DesktopClient) — never loopback from the renderer.
 *
 * 展示层不在这里：样式与组件已统一到 `renderer/components/ui.tsx`
 * （docs/product-ui/04-design-system.md）。
 */

export type T13ApiRequest = (input: ApiRequest) => Promise<ApiResponse>;

let apiRequestOverride: T13ApiRequest | null = null;
let clientOverride: DesktopClient | null = null;

export function setT13ApiRequest(request: T13ApiRequest | null): void {
  apiRequestOverride = request;
  clientOverride = null;
}

export function setT13Client(client: DesktopClient | null): void {
  clientOverride = client;
}

export function resetT13Client(): void {
  apiRequestOverride = null;
  clientOverride = null;
}

function getPreloadApi(): WorkforcePreloadApi {
  const fromWindow = (globalThis as { window?: { workforce?: WorkforcePreloadApi } }).window
    ?.workforce;
  if (fromWindow) {
    return fromWindow;
  }
  throw new Error("Workforce preload bridge is not available");
}

function fromApiResponse(res: ApiResponse): TransportResponse {
  if (res.ok) {
    return { status: res.status, headers: {}, body: res.body };
  }
  return {
    status: res.status,
    headers: { "content-type": "application/problem+json" },
    body: {
      type: `urn:workforce:error:${res.code}`,
      title: res.code,
      status: res.status,
      code: res.code,
      detail: res.message,
      instance: "",
      requestId: "",
      retryable: false,
    },
  };
}

function toApiRequest(req: TransportRequest): ApiRequest {
  const input: ApiRequest = { method: req.method, path: req.path };
  if (req.headers !== undefined) {
    input.headers = req.headers;
  }
  if (req.body !== undefined) {
    input.body = req.body;
  }
  return input;
}

function createBridgeTransport(): ClientTransport {
  return {
    async request(req: TransportRequest): Promise<TransportResponse> {
      const requestFn = apiRequestOverride ?? ((input) => getPreloadApi().api.request(input));
      return fromApiResponse(await requestFn(toApiRequest(req)));
    },
  };
}

export function getT13Client(): DesktopClient {
  if (clientOverride) {
    return clientOverride;
  }
  return createDesktopClient({ transport: createBridgeTransport() });
}

export function formatT13Error(error: unknown): string {
  if (error instanceof ProblemError) {
    return `${error.problem.title}（${error.problem.code}）: ${error.problem.detail}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败";
}

export function t13CommandOptions(ifMatch?: number | string): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export interface T13QueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useT13Query<T>(key: string, loader: () => Promise<T>): T13QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loaderRef
      .current()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatT13Error(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  return {
    data,
    error,
    loading,
    reload: () => {
      setTick((value) => value + 1);
    },
  };
}
