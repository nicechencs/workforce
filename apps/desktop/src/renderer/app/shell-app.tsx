import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createDesktopClient,
  type CapabilitiesDto,
  type DesktopClient,
} from "@workforce/desktop-client";
import { primaryNavItems, type ConnectionSnapshot, type WorkforcePreloadApi } from "@workforce/ui";

import { PlaceholderPage } from "../components/placeholder-page.js";
import { ShellFrame } from "../components/shell-frame.js";
import type { RouteRegistry } from "../routes/registry.js";
import { shouldRenderFeaturePage } from "./feature-modules.js";
import { parseHashPath, pathToHash } from "./hash-router.js";
import { createIpcTransport } from "./ipc-transport.js";
import { renderShell } from "./shell.js";
import { WorkforceProvider } from "./workforce-context.js";

export function ShellApp(props: { registry: RouteRegistry }): ReactNode {
  const { registry } = props;
  const [path, navigate] = useHashRoute();
  const [connection, setConnection] = useState<ConnectionSnapshot>({ status: "loading" });
  const [capabilities, setCapabilities] = useState<CapabilitiesDto | null>(null);
  const api = getPreloadApi();

  const client = useMemo(() => createRendererClient(api), [api]);

  useEffect(() => {
    if (!api) {
      setConnection({
        status: "error",
        message: "window.workforce is unavailable; preload bridge is required",
        recoverable: true,
      });
      return;
    }
    void api.connection.getState().then(setConnection);
    return api.connection.subscribe(setConnection);
  }, [api]);

  useEffect(() => {
    if (connection.status !== "online") {
      setCapabilities(null);
      return;
    }
    let cancelled = false;
    void client
      .getCapabilities()
      .then((next) => {
        if (!cancelled) {
          setCapabilities(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilities(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, connection]);

  const resolved = registry.resolve(path);
  const navPath =
    resolved === null
      ? path
      : (primaryNavItems().find((item) => item.slot === resolved.route.slot)?.path ?? path);
  const view = renderShell({
    connection,
    currentPath: navPath,
    title: resolved?.route.title ?? "Workforce",
  });
  const feature = resolved ? registry.getFeatureModule(resolved.route.slot) : undefined;
  const Page = feature?.Page;

  return (
    <WorkforceProvider value={{ client, connection, navigate, capabilities }}>
      <ShellFrame
        view={view}
        onNavigate={navigate}
        onBannerAction={(action) => {
          if (!api) {
            return;
          }
          if (action === "quit-ui") {
            void api.shell.quitUi();
            return;
          }
          void api.connection.reconnect().then(setConnection);
        }}
      >
        {shouldRenderFeaturePage(resolved, Page) && Page && resolved ? (
          (Page({ params: resolved.params, path, navigate }) as ReactNode)
        ) : (
          <PlaceholderPage title={resolved?.route.title ?? "未找到页面"} />
        )}
      </ShellFrame>
    </WorkforceProvider>
  );
}

function useHashRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : parseHashPath(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = (): void => {
      setPath(parseHashPath(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) {
      window.location.replace(`${window.location.pathname}${window.location.search}#/`);
    }
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const navigate = (next: string): void => {
    const hash = pathToHash(next);
    if (window.location.hash === hash) {
      setPath(parseHashPath(hash));
      return;
    }
    window.location.hash = hash;
  };

  return [path, navigate];
}

function getPreloadApi(): WorkforcePreloadApi | null {
  if (typeof window === "undefined" || !window.workforce) {
    return null;
  }
  return window.workforce;
}

function createRendererClient(api: WorkforcePreloadApi | null): DesktopClient {
  return createDesktopClient({
    transport: createIpcTransport(async (input) => {
      if (!api) {
        return {
          ok: false,
          status: 503,
          code: "preload_missing",
          message: "window.workforce is unavailable",
        };
      }
      return api.api.request(input);
    }),
  });
}
