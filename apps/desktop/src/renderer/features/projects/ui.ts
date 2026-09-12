import type { CSSProperties } from "react";

export const pageStyle: CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "var(--wf-font-body, 16px)",
  color: "var(--wf-color-text, #111827)",
  background: "var(--wf-color-page, #e8edf2)",
  padding: "var(--wf-space-xl, 24px)",
  minHeight: "100%",
};

export const cardStyle: CSSProperties = {
  background: "var(--wf-color-card, #ffffff)",
  border: "1px solid var(--wf-color-border, #d1d5db)",
  borderRadius: "var(--wf-radius-md, 6px)",
  padding: "var(--wf-space-lg, 16px)",
  marginBottom: "var(--wf-space-lg, 16px)",
};

export const titleStyle: CSSProperties = {
  fontSize: "var(--wf-font-title, 20px)",
  margin: "0 0 var(--wf-space-md, 12px)",
};

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--wf-font-label, 14px)",
  color: "var(--wf-color-text-muted, #4b5563)",
  marginBottom: "var(--wf-space-xs, 4px)",
};

export const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "var(--wf-font-body, 16px)",
  padding: "var(--wf-space-sm, 8px)",
  border: "1px solid var(--wf-color-border, #d1d5db)",
  borderRadius: "var(--wf-radius-sm, 4px)",
  marginBottom: "var(--wf-space-md, 12px)",
};

export const mutedStyle: CSSProperties = {
  color: "var(--wf-color-text-muted, #4b5563)",
  fontSize: "var(--wf-font-label, 14px)",
};

export const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--wf-space-sm, 8px)",
  alignItems: "center",
  marginBottom: "var(--wf-space-md, 12px)",
};

export const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

export const listItemStyle: CSSProperties = {
  borderBottom: "1px solid var(--wf-color-border, #d1d5db)",
  padding: "var(--wf-space-md, 12px) 0",
  cursor: "pointer",
};

export type ButtonKind = "primary" | "secondary" | "danger";

export function buttonStyle(kind: ButtonKind, disabled = false): CSSProperties {
  const background =
    kind === "primary"
      ? "var(--wf-color-primary, #1d4ed8)"
      : kind === "danger"
        ? "var(--wf-color-danger, #b91c1c)"
        : "var(--wf-color-card, #ffffff)";
  const color =
    kind === "secondary"
      ? "var(--wf-color-text, #111827)"
      : "var(--wf-color-primary-text, #ffffff)";
  return {
    fontSize: "var(--wf-font-label, 14px)",
    padding: "var(--wf-space-sm, 8px) var(--wf-space-md, 12px)",
    borderRadius: "var(--wf-radius-sm, 4px)",
    border: kind === "secondary" ? "1px solid var(--wf-color-border, #d1d5db)" : "none",
    background,
    color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

export const errorStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "var(--wf-color-danger, #b91c1c)",
  color: "var(--wf-color-danger, #b91c1c)",
};

export const warningStyle: CSSProperties = {
  ...cardStyle,
  borderColor: "var(--wf-color-warning, #c2410c)",
  color: "var(--wf-color-warning, #c2410c)",
};

export const tabListStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--wf-space-xs, 4px)",
  borderBottom: "1px solid var(--wf-color-border, #d1d5db)",
  marginBottom: "var(--wf-space-lg, 16px)",
};

export function tabButtonStyle(active: boolean): CSSProperties {
  return {
    fontSize: "var(--wf-font-label, 14px)",
    padding: "var(--wf-space-sm, 8px) var(--wf-space-md, 12px)",
    border: "none",
    borderBottom: active ? "2px solid var(--wf-color-primary, #1d4ed8)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--wf-color-primary, #1d4ed8)" : "var(--wf-color-text, #111827)",
    cursor: "pointer",
  };
}

export const badgeStyle = (tone: "health" | "warning" | "danger" | "muted"): CSSProperties => {
  const color =
    tone === "health"
      ? "var(--wf-color-health, #15803d)"
      : tone === "warning"
        ? "var(--wf-color-warning, #c2410c)"
        : tone === "danger"
          ? "var(--wf-color-danger, #b91c1c)"
          : "var(--wf-color-text-muted, #4b5563)";
  return {
    display: "inline-block",
    fontSize: "var(--wf-font-label, 14px)",
    color,
    border: `1px solid ${color}`,
    borderRadius: "var(--wf-radius-sm, 4px)",
    padding: "0 var(--wf-space-sm, 8px)",
  };
};
