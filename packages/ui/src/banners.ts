import type { ConnectionSnapshot } from "./connection.js";

export type BannerTone = "info" | "warning" | "danger";

export interface BannerAction {
  id: "retry" | "quit-ui";
  label: string;
}

export interface BannerModel {
  id: "loading" | "offline" | "version-mismatch" | "error";
  tone: BannerTone;
  title: string;
  message: string;
  recoverable: boolean;
  action?: BannerAction;
}

export type ShellOverlay = "loading" | null;

export function bannerForConnection(snapshot: ConnectionSnapshot): BannerModel | null {
  switch (snapshot.status) {
    case "loading":
      return {
        id: "loading",
        tone: "info",
        title: "正在连接本地 Daemon",
        message: "正在发现或启动独立后台进程。关闭窗口不会中断允许继续的任务。",
        recoverable: true,
      };
    case "offline":
      return {
        id: "offline",
        tone: "warning",
        title: "本地 Daemon 离线",
        message: "无法连接本机控制面。可以重试连接；未确认 stale 前不会启动第二个实例。",
        recoverable: true,
        action: { id: "retry", label: "重新连接" },
      };
    case "version-mismatch":
      return {
        id: "version-mismatch",
        tone: "danger",
        title: "协议版本不兼容",
        message: `桌面端期望 ${snapshot.expectedProtocolVersion}，当前 Daemon 为 ${snapshot.actualProtocolVersion}。这是可恢复错误，不会再启动第二个 Daemon。`,
        recoverable: true,
        action: { id: "retry", label: "重新检查" },
      };
    case "error":
      return {
        id: "error",
        tone: "danger",
        title: "无法安全连接",
        message: snapshot.message,
        recoverable: snapshot.recoverable,
        action: { id: "retry", label: "重试" },
      };
    case "online":
      return null;
  }
}

export function overlayForConnection(snapshot: ConnectionSnapshot): ShellOverlay {
  return snapshot.status === "loading" ? "loading" : null;
}
