import type { CSSProperties } from "react";

/**
 * T18/T20/T21 尚未改组合前的兼容再导出。
 *
 * 只引用 `packages/ui` 注入的 `--wf-*` 语义变量，不再携带第二套
 * `--wf-color-*` 名称或 hex 回退。新页面请直接组合 `components/ui.tsx`。
 */

export const pageStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "var(--wf-font-body)",
  color: "var(--wf-text-primary)",
  background: "var(--wf-bg-canvas)",
  padding: "var(--wf-space-12)",
  minHeight: "100%",
};

export const cardStyle: CSSProperties = {
  background: "var(--wf-bg-panel)",
  border: "1px solid var(--wf-border)",
  borderRadius: "var(--wf-radius-card)",
  padding: "var(--wf-space-16)",
  boxShadow: "var(--wf-shadow-xs)",
};

export const titleStyle: CSSProperties = {
  fontSize: "var(--wf-font-title)",
  fontWeight: 600,
  color: "var(--wf-text-primary)",
  margin: "0 0 var(--wf-space-12)",
};

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--wf-font-meta)",
  fontWeight: 500,
  color: "var(--wf-text-secondary)",
  marginBottom: "var(--wf-space-4)",
};

export const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  height: "var(--wf-control-h-lg)",
  fontSize: "var(--wf-font-body)",
  color: "var(--wf-text-primary)",
  background: "var(--wf-bg-panel)",
  padding: "0 var(--wf-space-8)",
  border: "1px solid var(--wf-border-control)",
  borderRadius: "var(--wf-radius-btn)",
  marginBottom: "var(--wf-space-12)",
};

export const mutedStyle: CSSProperties = {
  color: "var(--wf-text-muted)",
  fontSize: "var(--wf-font-meta)",
  margin: 0,
};

export const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--wf-space-8)",
  alignItems: "center",
  marginBottom: "var(--wf-space-12)",
};

export const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

export const listItemStyle: CSSProperties = {
  borderBottom: "1px solid var(--wf-border)",
  padding: "var(--wf-space-12) 0",
  cursor: "pointer",
};

export type ButtonKind = "primary" | "secondary" | "danger";

export function buttonStyle(kind: ButtonKind, disabled = false): CSSProperties {
  const background =
    kind === "primary"
      ? "var(--wf-accent)"
      : kind === "danger"
        ? "var(--wf-danger)"
        : "var(--wf-bg-hover)";
  const color =
    kind === "secondary" ? "var(--wf-text-primary)" : "var(--wf-accent-foreground)";
  return {
    display: "inline-flex",
    alignItems: "center",
    height: "var(--wf-control-h)",
    fontSize: "var(--wf-font-body)",
    fontWeight: 500,
    padding: "0 var(--wf-space-12)",
    borderRadius: "var(--wf-radius-btn)",
    border: kind === "secondary" ? "1px solid var(--wf-border)" : "1px solid transparent",
    background,
    color: kind === "danger" ? "var(--wf-danger-foreground)" : color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

export const errorStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "var(--wf-danger)",
  color: "var(--wf-danger)",
};

export const warningStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "var(--wf-warning)",
  color: "var(--wf-warning)",
};

export const tabListStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 2,
  borderRadius: "var(--wf-radius-card)",
  background: "var(--wf-bg-hover)",
  padding: 2,
  marginBottom: "var(--wf-space-12)",
};

export function tabButtonStyle(active: boolean): CSSProperties {
  return {
    fontSize: "var(--wf-font-body)",
    padding: "var(--wf-space-4) var(--wf-space-8)",
    border: "none",
    borderRadius: "var(--wf-radius-btn)",
    background: active ? "var(--wf-bg-raised)" : "transparent",
    color: active ? "var(--wf-text-primary)" : "var(--wf-text-secondary)",
    fontWeight: active ? 500 : 400,
    boxShadow: active ? "var(--wf-shadow-sm)" : "none",
    cursor: "pointer",
  };
}

export const badgeStyle = (tone: "health" | "warning" | "danger" | "muted"): CSSProperties => {
  const color =
    tone === "health"
      ? "var(--wf-success)"
      : tone === "warning"
        ? "var(--wf-warning)"
        : tone === "danger"
          ? "var(--wf-danger)"
          : "var(--wf-text-secondary)";
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "var(--wf-font-meta)",
    fontWeight: 500,
    color,
    background: "var(--wf-bg-subtle)",
    border: "1px solid transparent",
    borderRadius: "var(--wf-radius-full)",
    padding: "1px var(--wf-space-8)",
  };
};
