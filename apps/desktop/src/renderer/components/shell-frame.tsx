import type { ReactNode } from "react";

import type { BannerModel, ShellView } from "@workforce/ui";

import { bannerToneClass } from "./banners.js";

export function ShellFrame(props: {
  view: ShellView;
  onNavigate: (path: string) => void;
  onBannerAction?: (action: NonNullable<BannerModel["action"]>["id"]) => void;
  children: ReactNode;
}): ReactNode {
  const { view, onNavigate, onBannerAction, children } = props;
  return (
    <div className="wf-shell">
      <aside className="wf-nav" aria-label="一级导航">
        <div className="wf-brand">Workforce</div>
        <nav className="wf-nav-list">
          {view.nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.current ? "wf-nav-item is-current" : "wf-nav-item"}
              disabled={!item.enabled}
              aria-current={item.current ? "page" : undefined}
              onClick={() => {
                if (item.enabled) {
                  onNavigate(item.path);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <header className="wf-top">
        <div className="wf-top-context">
          <span className="wf-top-workspace">本机</span>
          <span className="wf-top-sep" aria-hidden="true">
            /
          </span>
          <span className="wf-top-page">{view.title}</span>
        </div>
        <div className="wf-top-actions">
          <span className={`wf-connection wf-connection-${view.connection.status}`}>
            {connectionLabel(view.connection.status)}
          </span>
          <button type="button" className="wf-top-button" disabled>
            通知
          </button>
          <button type="button" className="wf-top-button" disabled>
            新建
          </button>
        </div>
      </header>
      <main className="wf-main">
        {view.banner ? (
          <div className={bannerToneClass(view.banner)} role="status">
            <strong>{view.banner.title}</strong>
            <p>{view.banner.message}</p>
            {view.banner.action ? (
              <button
                type="button"
                className="wf-banner-action"
                onClick={() => onBannerAction?.(view.banner?.action?.id ?? "retry")}
              >
                {view.banner.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
        {view.overlay === "loading" ? (
          <div className="wf-overlay" role="status">
            正在连接本地 Daemon
          </div>
        ) : null}
        <div className={view.mainEnabled ? "wf-outlet" : "wf-outlet is-disabled"}>{children}</div>
      </main>
    </div>
  );
}

function connectionLabel(status: ShellView["connection"]["status"]): string {
  switch (status) {
    case "loading":
      return "连接中";
    case "online":
      return "已连接";
    case "offline":
      return "离线";
    case "version-mismatch":
      return "版本不兼容";
    case "error":
      return "连接错误";
  }
}
