export const color = {
  page: "#e8edf2",
  card: "#ffffff",
  text: "#111827",
  textMuted: "#4b5563",
  border: "#d1d5db",
  primary: "#1d4ed8",
  primaryText: "#ffffff",
  health: "#15803d",
  warning: "#c2410c",
  danger: "#b91c1c",
} as const;

export const fontSize = {
  body: "16px",
  label: "14px",
  title: "20px",
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
} as const;

export const radius = {
  sm: "4px",
  md: "6px",
} as const;

export const tokens = {
  color,
  fontSize,
  space,
  radius,
} as const;

export type DesignTokens = typeof tokens;

export function tokensAsCssVariables(): string {
  return [
    ":root {",
    `  --wf-color-page: ${color.page};`,
    `  --wf-color-card: ${color.card};`,
    `  --wf-color-text: ${color.text};`,
    `  --wf-color-text-muted: ${color.textMuted};`,
    `  --wf-color-border: ${color.border};`,
    `  --wf-color-primary: ${color.primary};`,
    `  --wf-color-primary-text: ${color.primaryText};`,
    `  --wf-color-health: ${color.health};`,
    `  --wf-color-warning: ${color.warning};`,
    `  --wf-color-danger: ${color.danger};`,
    `  --wf-font-body: ${fontSize.body};`,
    `  --wf-font-label: ${fontSize.label};`,
    `  --wf-font-title: ${fontSize.title};`,
    `  --wf-space-xs: ${space.xs};`,
    `  --wf-space-sm: ${space.sm};`,
    `  --wf-space-md: ${space.md};`,
    `  --wf-space-lg: ${space.lg};`,
    `  --wf-space-xl: ${space.xl};`,
    `  --wf-radius-sm: ${radius.sm};`,
    `  --wf-radius-md: ${radius.md};`,
    "}",
  ].join("\n");
}
