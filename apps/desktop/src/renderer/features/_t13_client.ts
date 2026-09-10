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
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * T13 typed client: DesktopClient over `window.workforce.api.request`.
 * Tests inject the preload request (or a DesktopClient) — never loopback from the renderer.
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

export const t13Styles = {
  page: {
    fontFamily: "system-ui, sans-serif",
    color: "var(--wf-color-text)",
    background: "var(--wf-color-page)",
    fontSize: "var(--wf-font-body)",
    padding: "var(--wf-space-xl)",
    minHeight: "100%",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "var(--wf-space-md)",
    marginBottom: "var(--wf-space-lg)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: "var(--wf-font-title)",
    fontWeight: 600,
  } satisfies CSSProperties,
  muted: {
    color: "var(--wf-color-text-muted)",
    fontSize: "var(--wf-font-label)",
  } satisfies CSSProperties,
  card: {
    background: "var(--wf-color-card)",
    border: "1px solid var(--wf-color-border)",
    borderRadius: "var(--wf-radius-md)",
    padding: "var(--wf-space-lg)",
    marginBottom: "var(--wf-space-md)",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(16rem, 22rem)",
    gap: "var(--wf-space-lg)",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: "var(--wf-space-sm)",
    flexWrap: "wrap",
    alignItems: "center",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  button: {
    fontSize: "var(--wf-font-label)",
    padding: "var(--wf-space-sm) var(--wf-space-md)",
    borderRadius: "var(--wf-radius-sm)",
    border: "1px solid var(--wf-color-border)",
    background: "var(--wf-color-card)",
    color: "var(--wf-color-text)",
    cursor: "pointer",
  } satisfies CSSProperties,
  buttonPrimary: {
    background: "var(--wf-color-primary)",
    color: "var(--wf-color-primary-text)",
    borderColor: "var(--wf-color-primary)",
  } satisfies CSSProperties,
  buttonDanger: {
    background: "var(--wf-color-danger)",
    color: "var(--wf-color-primary-text)",
    borderColor: "var(--wf-color-danger)",
  } satisfies CSSProperties,
  buttonDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  } satisfies CSSProperties,
  health: { color: "var(--wf-color-health)" } satisfies CSSProperties,
  warning: { color: "var(--wf-color-warning)" } satisfies CSSProperties,
  danger: { color: "var(--wf-color-danger)" } satisfies CSSProperties,
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: "var(--wf-font-label)",
    margin: 0,
  } satisfies CSSProperties,
  input: {
    width: "100%",
    fontSize: "var(--wf-font-body)",
    padding: "var(--wf-space-sm)",
    border: "1px solid var(--wf-color-border)",
    borderRadius: "var(--wf-radius-sm)",
    boxSizing: "border-box",
  } satisfies CSSProperties,
} as const;

interface T13PageProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode | undefined;
  subtitle?: string | undefined;
}

export function T13Page(props: T13PageProps): ReactNode {
  const subtitle =
    props.subtitle !== undefined
      ? createElement("p", { style: t13Styles.muted }, props.subtitle)
      : null;
  return createElement(
    "main",
    { style: t13Styles.page },
    createElement(
      "header",
      { style: t13Styles.header },
      createElement(
        "div",
        null,
        createElement("h1", { style: t13Styles.title }, props.title),
        subtitle,
      ),
      props.actions !== undefined
        ? createElement("div", { style: t13Styles.actions }, props.actions)
        : null,
    ),
    props.children,
  );
}

export function T13Card(props: { children: ReactNode; testId?: string | undefined }): ReactNode {
  return createElement(
    "section",
    {
      style: t13Styles.card,
      ...(props.testId !== undefined ? { "data-testid": props.testId } : {}),
    },
    props.children,
  );
}

export function T13Error(props: { message: string | null }): ReactNode {
  if (props.message === null || props.message.length === 0) {
    return null;
  }
  return createElement(
    "p",
    { style: { ...t13Styles.muted, ...t13Styles.danger }, role: "alert" },
    props.message,
  );
}

interface T13ButtonProps {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  kind?: "primary" | "danger" | "default" | undefined;
  testId?: string | undefined;
}

export function T13Button(props: T13ButtonProps): ReactNode {
  const kind = props.kind ?? "default";
  const disabled = props.disabled === true;
  const style: CSSProperties = {
    ...t13Styles.button,
    ...(kind === "primary" ? t13Styles.buttonPrimary : {}),
    ...(kind === "danger" ? t13Styles.buttonDanger : {}),
    ...(disabled ? t13Styles.buttonDisabled : {}),
  };
  return createElement(
    "button",
    {
      type: "button",
      onClick: disabled ? undefined : props.onClick,
      disabled,
      style,
      ...(props.testId !== undefined ? { "data-testid": props.testId } : {}),
    },
    props.children,
  );
}
