import { ProblemError, type CommandOptions } from "@workforce/desktop-client";
import { useEffect, useRef, useState } from "react";

export function formatClientError(error: unknown): string {
  if (error instanceof ProblemError) {
    return `${error.problem.title}（${error.problem.code}）: ${error.problem.detail}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败";
}

export function commandOptions(ifMatch?: number | string): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export interface ClientQueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useClientQuery<T>(key: string, loader: () => Promise<T>): ClientQueryResult<T> {
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
          setError(formatClientError(err));
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
