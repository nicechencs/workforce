import { useEffect, useState, type ReactNode } from "react";

import type { CapabilitiesDto } from "@workforce/desktop-client";
import { isChatPath, primaryNavItems, type ConnectionSnapshot } from "@workforce/ui";

import { OutletErrorBoundary } from "../components/outlet-error-boundary.js";
import { PlaceholderPage } from "../components/placeholder-page.js";
import { ShellFrame } from "../components/shell-frame.js";
import { isUnwiredShellSlot, unwiredShellDescription } from "../routes/catalog.js";
import type { RouteRegistry } from "../routes/registry.js";
import { shouldRenderFeaturePage } from "./feature-modules.js";
import { parseHashPath, pathToHash } from "./hash-router.js";
import { getPreloadApi, getWorkforceClient } from "./renderer-client.js";
import { renderShell } from "./shell.js";
import { WorkforceProvider } from "./workforce-context.js";

export function ShellApp(props: { registry: RouteRegistry }): ReactNode {
  const { registry } = props;
  const [path, navigate] = useHashRoute();
  const [connection, setConnection] = useState<ConnectionSnapshot>({ status: "loading" });
  const [capabilities, setCapabilities] = useState<CapabilitiesDto | null>(null);
  const api = getPreloadApi() ?? null;
  const client = getWorkforceClient();

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
  const showFeaturePage = shouldRenderFeaturePage(resolved, Page) && Page && resolved;
  const unwired = !showFeaturePage && isUnwiredShellSlot(resolved?.route.slot);

  return (
    <WorkforceProvider value={{ client, connection, navigate, capabilities }}>
      <ShellFrame
        view={view}
        onNavigate={navigate}
        chatCurrent={isChatPath(path)}
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
        <OutletErrorBoundary resetKey={path}>
          {showFeaturePage && Page && resolved ? (
            <Page key={path} params={resolved.params} path={path} navigate={navigate} />
          ) : (
            <PlaceholderPage
              title={resolved?.route.title ?? "未找到页面"}
              description={unwired ? unwiredShellDescription(resolved?.route.slot) : undefined}
              unwired={unwired}
            />
          )}
        </OutletErrorBoundary>
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

