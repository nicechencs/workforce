import { useEffect, useState, type ReactNode } from "react";

import { CHAT_PATH, SHELL_CHAT, type BannerModel, type ShellView } from "@workforce/ui";

import { nextThemeMode, themeModeLabel, useTheme } from "../app/theme.js";
import { cn } from "./cn.js";
import { IconChat, IconMoon, IconPanelClose, IconPanelOpen, IconSun, IconSystem } from "./icons.js";
import { PageChromeProvider, usePageChrome } from "./page-chrome.js";
import { Button, NavIcon, Notice, StatusText } from "./ui.js";

const NAV_COLLAPSED_KEY = "workforce:nav-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, String(collapsed));
  } catch {
    // 存储不可用时不持久化，仍保留本次会话的折叠状态。
  }
}

export interface ShellFrameProps {
  view: ShellView;
  onNavigate: (path: string) => void;
  onBannerAction?: ((action: NonNullable<BannerModel["action"]>["id"]) => void) | undefined;
  /** Global Chat chrome. Always openable; `/chat` is an empty unwired shell until the feature page registers. */
  chatCurrent?: boolean | undefined;
  children: ReactNode;
}

export function ShellFrame(props: ShellFrameProps): ReactNode {
  const { view, onNavigate, onBannerAction, children } = props;
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  return (
    <PageChromeProvider>
      <ShellFrameLayout
        view={view}
        collapsed={collapsed}
        onToggleCollapsed={() => {
          setCollapsed((current) => !current);
        }}
        onNavigate={onNavigate}
        onBannerAction={onBannerAction}
        chatCurrent={props.chatCurrent}
      >
        {children}
      </ShellFrameLayout>
    </PageChromeProvider>
  );
}

function ShellFrameLayout(
  props: ShellFrameProps & {
    collapsed: boolean;
    onToggleCollapsed: () => void;
  },
): ReactNode {
  const { view, collapsed, onToggleCollapsed, onNavigate, onBannerAction, children } = props;
  const chrome = usePageChrome();
  const title = chrome?.title ?? view.title;
  const subtitle = chrome?.subtitle;

  return (
    <div className="wf-shell" data-nav-collapsed={collapsed ? "true" : "false"}>
      <div className="wf-shell-body">
        <aside className="wf-nav" aria-label="一级导航">
          <div className="wf-nav-header">
            {collapsed ? (
              <button
                type="button"
                className="wf-nav-brand-toggle"
                aria-label="展开侧栏"
                aria-expanded={false}
                onClick={onToggleCollapsed}
              >
                <span className="wf-brand-mark" aria-hidden="true">
                  W
                </span>
                <span className="wf-nav-expand-icon" aria-hidden="true">
                  <IconPanelOpen size={16} />
                </span>
              </button>
            ) : (
              <>
                <span className="wf-brand">
                  <span className="wf-brand-mark" aria-hidden="true">
                    W
                  </span>
                  <span className="wf-brand-label">Workforce</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="wf-nav-collapse"
                  aria-label="收起侧栏"
                  aria-expanded={true}
                  onClick={onToggleCollapsed}
                >
                  <IconPanelClose size={16} />
                </Button>
              </>
            )}
          </div>
          <nav className="wf-nav-list">
            <div className="wf-nav-group-label">工作台</div>
            {view.nav.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn("wf-nav-item", item.current && "is-current")}
                disabled={!item.enabled}
                aria-current={item.current ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  if (item.enabled) {
                    onNavigate(item.path);
                  }
                }}
              >
                <NavIcon slot={item.slot} size={18} strokeWidth={1.6} />
                <span className="wf-nav-item-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="wf-shell-main">
          <header className="wf-topbar">
            <div className="wf-topbar-context">
              <h1 className="wf-topbar-page">{title}</h1>
              {subtitle !== undefined ? (
                <span className="wf-topbar-subtitle">{subtitle}</span>
              ) : null}
              <span className="wf-topbar-sep" aria-hidden="true">
                /
              </span>
              <span className="wf-topbar-workspace">本机</span>
            </div>
            <div className="wf-topbar-actions">
              <Button
                variant={props.chatCurrent === true ? "outline" : "ghost"}
                size="sm"
                testId="shell-open-chat"
                aria-label="打开 Chat"
                aria-current={props.chatCurrent === true ? "page" : undefined}
                title={SHELL_CHAT.label}
                onClick={() => {
                  onNavigate(CHAT_PATH);
                }}
              >
                <IconChat size={16} />
                Chat
              </Button>
              <StatusText tone={connectionTone(view.connection.status)}>
                {connectionLabel(view.connection.status)}
              </StatusText>
              <ThemeToggle />
            </div>
          </header>
          <main className={view.mainEnabled ? "wf-main" : "wf-main is-disabled"}>
            {view.banner ? (
              <div className="wf-main-banner">
                <Notice
                  tone={bannerTone(view.banner)}
                  title={view.banner.title}
                  actions={
                    view.banner.action ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          onBannerAction?.(view.banner?.action?.id ?? "retry");
                        }}
                      >
                        {view.banner.action.label}
                      </Button>
                    ) : undefined
                  }
                >
                  <p className="wf-body-note">{view.banner.message}</p>
                </Notice>
              </div>
            ) : null}
            {view.overlay === "loading" ? (
              <div className="wf-overlay" role="status">
                <span className="wf-spinner" aria-hidden="true" />
                正在连接本地 Daemon
              </div>
            ) : null}
            <div className="wf-outlet">{children}</div>
          </main>
        </div>
      </div>
      <footer className="wf-statusbar">
        {view.connection.status === "online" ? (
          <span className="wf-inline-status">
            协议 {view.connection.protocolVersion} ·{" "}
            {view.connection.mode === "spawn" ? "本机启动" : "重连"}
          </span>
        ) : (
          <StatusText tone={connectionTone(view.connection.status)}>
            {connectionLabel(view.connection.status)}
          </StatusText>
        )}
        <span className="wf-push">Workforce · 本机 Daemon</span>
      </footer>
    </div>
  );
}

function ThemeToggle(): ReactNode {
  const theme = useTheme();
  const next = nextThemeMode(theme.mode);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`主题：${themeModeLabel(theme.mode)}，点击切换到${themeModeLabel(next)}`}
      title={`主题：${themeModeLabel(theme.mode)}`}
      onClick={() => {
        theme.setMode(next);
      }}
    >
      {theme.mode === "light" ? (
        <IconSun size={16} />
      ) : theme.mode === "dark" ? (
        <IconMoon size={16} />
      ) : (
        <IconSystem size={16} />
      )}
    </Button>
  );
}

function bannerTone(banner: BannerModel): "info" | "warning" | "danger" {
  return banner.tone;
}

function connectionTone(
  status: ShellView["connection"]["status"],
): "success" | "warning" | "danger" {
  switch (status) {
    case "online":
      return "success";
    case "loading":
    case "offline":
      return "warning";
    case "version-mismatch":
    case "error":
      return "danger";
  }
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
