import {
  ProblemError,
  type CommandOptions,
  type DesktopClient,
} from "@workforce/desktop-client";
import type { ApiRequest, ApiResponse } from "@workforce/ui";
import { useEffect, useRef, useState } from "react";

import {
  getWorkforceClient,
  resetRendererClient,
  setApiRequestForTests,
  setWorkforceClientForTests,
} from "../app/renderer-client.js";

/**
 * T13 typed client: same production DesktopClient as the shell / hooks.
 * Tests inject the preload request (or a DesktopClient) — never loopback from the renderer.
 *
 * 展示层不在这里：样式与组件已统一到 `renderer/components/ui.tsx`
 * （docs/product-ui/04-design-system.md）。
 */

export type T13ApiRequest = (input: ApiRequest) => Promise<ApiResponse>;

export function setT13ApiRequest(request: T13ApiRequest | null): void {
  setApiRequestForTests(request);
}

export function setT13Client(client: DesktopClient | null): void {
  setWorkforceClientForTests(client);
}

export function resetT13Client(): void {
  resetRendererClient();
}

export function getT13Client(): DesktopClient {
  return getWorkforceClient();
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
