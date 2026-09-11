/**
 * Workforce 设计 token 真源。
 *
 * 语义、类型阶、圆角、阴影和 Agent 品牌色与 AgentHub（`src/styles/tokens.ts`）
 * 对齐：同一套 surface / text / status / accent 角色名，同一组四档字号，
 * 同一组 8/12/16 圆角。差异只在命名空间：Workforce 统一使用 `--wf-` 前缀。
 *
 * 运行时用法：
 * - CSS → `var(--wf-…)`（见 apps/desktop/src/renderer/styles.css）
 * - 主题与主题色 → `html.dark`、`html[data-accent]`、`html[data-canvas]`
 * - TS 需要具体色值时 → `THEME` / `ACCENT_STATES` / `agentHex()`
 *
 * 消费方不得再自写一套 hex、字号或圆角（docs/product-ui/04-design-system.md）。
 */

export type ThemeScheme = "light" | "dark";

/** CSS 变量前缀。改这里等于换命名空间，需同步 styles.css。 */
export const CSS_VAR_PREFIX = "--wf-";

/**
 * 可切换的产品主题色。页面只使用 `--wf-accent` 及其
 * hover / pressed / foreground / subtle / text 伴随变量。
 */
export const ACCENT_PALETTES = {
  indigo: { light: "#4f46e5", dark: "#a5b4fc" },
  blue: { light: "#2563eb", dark: "#93c5fd" },
  teal: { light: "#0f766e", dark: "#5eead4" },
  rose: { light: "#e11d48", dark: "#fda4af" },
  amber: { light: "#c2410c", dark: "#fdba74" },
} as const;

export type AccentId = keyof typeof ACCENT_PALETTES;
export const DEFAULT_ACCENT_ID = "blue" as const satisfies AccentId;
export const ACCENT_IDS = Object.keys(ACCENT_PALETTES) as AccentId[];

export function isAccentId(value: string): value is AccentId {
  return (ACCENT_IDS as readonly string[]).includes(value);
}

/** accent 的完整色阶：按钮、链接、焦点环和选中底色。 */
export type AccentTone = {
  fill: string;
  hover: string;
  pressed: string;
  foreground: string;
  subtle: string;
  text: string;
};

export const ACCENT_STATES: Record<AccentId, Record<ThemeScheme, AccentTone>> = {
  indigo: {
    light: {
      fill: "#4f46e5",
      hover: "#4338ca",
      pressed: "#3730a3",
      foreground: "#ffffff",
      subtle: "#eef2ff",
      text: "#4338ca",
    },
    dark: {
      fill: "#a5b4fc",
      hover: "#c7d2fe",
      pressed: "#818cf8",
      foreground: "#1e1b4b",
      subtle: "#252343",
      text: "#c7d2fe",
    },
  },
  blue: {
    light: {
      fill: "#2563eb",
      hover: "#1d4ed8",
      pressed: "#1e40af",
      foreground: "#ffffff",
      subtle: "#eff6ff",
      text: "#1d4ed8",
    },
    dark: {
      fill: "#93c5fd",
      hover: "#bfdbfe",
      pressed: "#60a5fa",
      foreground: "#172554",
      subtle: "#17263b",
      text: "#bfdbfe",
    },
  },
  teal: {
    light: {
      fill: "#0f766e",
      hover: "#115e59",
      pressed: "#134e4a",
      foreground: "#ffffff",
      subtle: "#f0fdfa",
      text: "#115e59",
    },
    dark: {
      fill: "#5eead4",
      hover: "#99f6e4",
      pressed: "#2dd4bf",
      foreground: "#042f2e",
      subtle: "#102e2b",
      text: "#99f6e4",
    },
  },
  rose: {
    light: {
      fill: "#e11d48",
      hover: "#be123c",
      pressed: "#9f1239",
      foreground: "#ffffff",
      subtle: "#fff1f2",
      text: "#be123c",
    },
    dark: {
      fill: "#fda4af",
      hover: "#fecdd3",
      pressed: "#fb7185",
      foreground: "#4c0519",
      subtle: "#351c2a",
      text: "#fecdd3",
    },
  },
  amber: {
    light: {
      fill: "#c2410c",
      hover: "#9a3412",
      pressed: "#7c2d12",
      foreground: "#ffffff",
      subtle: "#fff7ed",
      text: "#9a3412",
    },
    dark: {
      fill: "#fdba74",
      hover: "#fed7aa",
      pressed: "#fb923c",
      foreground: "#431407",
      subtle: "#332315",
      text: "#fed7aa",
    },
  },
};

/**
 * 浅色画布色板。只在浅色主题生效，不得覆盖 `.dark` 下的 `--wf-bg-*`。
 * `canvas` 是页面底色，`subtle` 是比它更深一档的同色带。
 */
export const CANVAS_PALETTES = {
  gray: { canvas: "#f3f3f5", subtle: "#ececef" },
  white: { canvas: "#fafafa", subtle: "#f0f0f0" },
  paper: { canvas: "#f6f3ee", subtle: "#eee8e0" },
  mist: { canvas: "#eef2f6", subtle: "#e4eaf0" },
  sky: { canvas: "#eef5fb", subtle: "#e3eef8" },
  mint: { canvas: "#eef8f3", subtle: "#e1f0e8" },
  sand: { canvas: "#f6f0e6", subtle: "#eee6d8" },
  lilac: { canvas: "#f4f1f8", subtle: "#ebe6f2" },
} as const;

export type CanvasId = keyof typeof CANVAS_PALETTES;
export const DEFAULT_CANVAS_ID = "gray" as const satisfies CanvasId;
export const CANVAS_IDS = Object.keys(CANVAS_PALETTES) as CanvasId[];

export function isCanvasId(value: string): value is CanvasId {
  return (CANVAS_IDS as readonly string[]).includes(value);
}

/**
 * 语义主题色。键名不带前缀，emit 时统一加 `--wf-`。
 * surface 分工（改这里，全站跟随）：
 * - `bg-canvas` — 页面、主列、顶栏
 * - `bg-panel` — 卡片、侧栏、对话内容
 * - `bg-raised` — 轨道上被抬起的项（选中 Tab、分段控件选中项）
 * - `bg-subtle` — 内嵌条带、表头（不是第二个页面底色）
 */
export const THEME = {
  light: {
    "bg-canvas": "#f3f3f5",
    "bg-panel": "#ffffff",
    "bg-raised": "#ffffff",
    "bg-subtle": "#ececef",
    "bg-hover": "#ebebed",
    "bg-active": "#e4e4e7",
    border: "#e6e6e9",
    "border-strong": "#d6d6da",
    "border-control": "#85858f",
    "text-primary": "#18181b",
    "text-secondary": "#45454c",
    "text-muted": "#55555d",
    "text-disabled": "#a1a1aa",
    success: "#15803d",
    "success-subtle": "#f0fdf4",
    warning: "#92400e",
    "warning-subtle": "#fffbeb",
    danger: "#b91c1c",
    "danger-subtle": "#fef2f2",
    "danger-foreground": "#ffffff",
    info: "#1d4ed8",
    "info-subtle": "#eff6ff",
  },
  dark: {
    "bg-canvas": "#111113",
    "bg-panel": "#1c1c1f",
    "bg-raised": "#3a3a41",
    "bg-subtle": "#242428",
    "bg-hover": "#2c2c31",
    "bg-active": "#36363c",
    border: "#3f3f46",
    "border-strong": "#5a5a63",
    "border-control": "#8b8b93",
    "text-primary": "#f4f4f5",
    "text-secondary": "#c4c4cc",
    "text-muted": "#9b9ba3",
    "text-disabled": "#6b6b73",
    success: "#86efac",
    "success-subtle": "#142a20",
    warning: "#fcd34d",
    "warning-subtle": "#302510",
    danger: "#f87171",
    "danger-subtle": "#3f1d22",
    "danger-foreground": "#450a0a",
    info: "#93c5fd",
    "info-subtle": "#17263b",
  },
} as const satisfies Record<ThemeScheme, Record<string, string>>;

/**
 * Agent / Runtime 品牌色（身份圆点、图表、头像底）。
 * 这是色位，不是产品目录：新增运行时时加一个槽位，不在页面里写 hex。
 * `mock` 是 Workforce 本地 Mock Runtime 的中性色。
 */
export const AGENT_COLORS = {
  mock: { light: "#6b7280", dark: "#9ca3af" },
  claude: { light: "#d97757", dark: "#d97757" },
  codex: { light: "#7189ff", dark: "#8b9bff" },
  kimi: { light: "#1783ff", dark: "#3d94ff" },
  grok: { light: "#111111", dark: "#f5f5f5" },
  pi: { light: "#111111", dark: "#f5f5f5" },
  workbuddy: { light: "#0ec8a9", dark: "#2dd4bf" },
  cursor: { light: "#171717", dark: "#edecec" },
  dsh: { light: "#4d6bfe", dark: "#6b8cff" },
  zcode: { light: "#171717", dark: "#e5e5e5" },
  kiro: { light: "#9046ff", dark: "#a78bfa" },
} as const;

export type AgentColorId = keyof typeof AGENT_COLORS;
export const AGENT_COLOR_IDS = Object.keys(AGENT_COLORS) as AgentColorId[];

export function isAgentColorId(value: string): value is AgentColorId {
  return (AGENT_COLOR_IDS as readonly string[]).includes(value);
}

/** 圆角阶。控件 8、卡片 12、输入壳 16、产品标 22%。 */
export const RADIUS = {
  btn: "8px",
  card: "12px",
  lg: "16px",
  mark: "22%",
  full: "9999px",
} as const;

/**
 * UI 字号：三档日常 + 一档空态。
 *
 * | 标准    | 变量                 | 像素 | 用途 |
 * | display | `--wf-font-display`  | 22 | 空态主句 |
 * | title   | `--wf-font-title`    | 18 | 页标题、关键数字 |
 * | body    | `--wf-font-body`     | 14 | 正文、按钮、列表名、表单、分区标题 |
 * | meta    | `--wf-font-meta`     | 12 | 表头、时间、路径、角标、说明 |
 */
export const TYPE_SCALE = {
  display: { size: "22px", lineHeight: "1.27" },
  title: { size: "18px", lineHeight: "1.33" },
  body: { size: "14px", lineHeight: "1.57" },
  meta: { size: "12px", lineHeight: "1.5" },
} as const;

export type TypeScaleRole = keyof typeof TYPE_SCALE;

/** 间距阶梯 4/8/12/16/24/32。业务代码只引用这些档。 */
export const SPACE = {
  4: "4px",
  8: "8px",
  12: "12px",
  16: "16px",
  24: "24px",
  32: "32px",
} as const;

/** 控件与 chrome 几何。改这里，按钮/输入/顶栏/状态栏一起变。 */
export const GEOMETRY = {
  "control-h": "28px",
  "control-h-lg": "32px",
  "chrome-h": "44px",
  "statusbar-h": "32px",
  "icon-sm": "14px",
  "icon-md": "16px",
  "icon-nav": "18px",
} as const;

export const SHADOWS = {
  light: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.04)",
    sm: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03)",
    md: "0 4px 12px rgba(0, 0, 0, 0.08)",
    lg: "0 16px 48px rgba(0, 0, 0, 0.16)",
  },
  dark: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.2)",
    sm: "0 1px 3px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.18)",
    md: "0 4px 12px rgba(0, 0, 0, 0.4)",
    lg: "0 16px 48px rgba(0, 0, 0, 0.55)",
  },
} as const satisfies Record<ThemeScheme, Record<string, string>>;

/** 画布外缝（应用壳四周）与分栏分隔条热区，单位 px。 */
export const SHELL = {
  canvas: 12,
  inset: 12,
  separator: 8,
} as const;

/** 主题色 CSS 变量名（`--wf-accent` 等）。 */
export function accentCssVars(tone: AccentTone): Record<string, string> {
  return {
    accent: tone.fill,
    "accent-hover": tone.hover,
    "accent-pressed": tone.pressed,
    "accent-foreground": tone.foreground,
    "accent-subtle": tone.subtle,
    "accent-text": tone.text,
  };
}

/** Agent 品牌色的 CSS 变量名，页面只引用变量、不复制 hex。 */
export function agentCssVar(id: AgentColorId): string {
  return `var(${CSS_VAR_PREFIX}agent-${id})`;
}

/** 给需要 hex 的地方（对比度检查、图表）取当前主题的品牌色。 */
export function agentHex(id: AgentColorId, scheme: ThemeScheme): string {
  return AGENT_COLORS[id][scheme];
}

function declarations(record: Record<string, string>, prefix = CSS_VAR_PREFIX): string {
  return Object.entries(record)
    .map(([key, value]) => `  ${prefix}${key}: ${value};`)
    .join("\n");
}

function agentDeclarations(scheme: ThemeScheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of AGENT_COLOR_IDS) {
    out[`agent-${id}`] = AGENT_COLORS[id][scheme];
  }
  return out;
}

function radiusDeclarations(): Record<string, string> {
  return {
    "radius-btn": RADIUS.btn,
    "radius-card": RADIUS.card,
    "radius-lg": RADIUS.lg,
    "radius-mark": RADIUS.mark,
    "radius-full": RADIUS.full,
  };
}

function typeDeclarations(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of Object.keys(TYPE_SCALE) as TypeScaleRole[]) {
    out[`font-${role}`] = TYPE_SCALE[role].size;
    out[`leading-${role}`] = TYPE_SCALE[role].lineHeight;
  }
  return out;
}

function canvasDeclarations(id: CanvasId): Record<string, string> {
  const palette = CANVAS_PALETTES[id];
  return { "bg-canvas": palette.canvas, "bg-subtle": palette.subtle };
}

function shadowDeclarations(scheme: ThemeScheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of ["xs", "sm", "md", "lg"] as const) {
    out[`shadow-${step}`] = SHADOWS[scheme][step];
  }
  return out;
}

function spaceDeclarations(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [step, value] of Object.entries(SPACE)) {
    out[`space-${step}`] = value;
  }
  return out;
}

/**
 * 生成完整 CSS 变量表：
 * 1. `:root` — 浅色主题 + 默认 accent/canvas + 浅色 Agent 色
 * 2. `html.dark` — 深色主题 + 深色 accent + 深色 Agent 色（不覆盖 canvas 色板）
 * 3. 每个 accent 的 light / dark 覆盖
 * 4. 每个 canvas 的浅色覆盖
 *
 * 由 `apps/desktop/src/renderer/main.tsx` 在首屏注入；`index.html` 只做兜底，
 * 不复制色值。
 */
export function tokensAsCssVariables(): string {
  const chunks: string[] = [];

  chunks.push(
    [
      ":root {",
      declarations(THEME.light),
      declarations(accentCssVars(ACCENT_STATES[DEFAULT_ACCENT_ID].light)),
      declarations(canvasDeclarations(DEFAULT_CANVAS_ID)),
      declarations(radiusDeclarations()),
      declarations(typeDeclarations()),
      declarations(spaceDeclarations()),
      declarations(GEOMETRY),
      declarations(shadowDeclarations("light")),
      declarations(agentDeclarations("light")),
      "}",
    ].join("\n"),
  );

  chunks.push(
    [
      "html.dark {",
      declarations(THEME.dark),
      declarations(accentCssVars(ACCENT_STATES[DEFAULT_ACCENT_ID].dark)),
      declarations(shadowDeclarations("dark")),
      declarations(agentDeclarations("dark")),
      "}",
    ].join("\n"),
  );

  for (const id of ACCENT_IDS) {
    chunks.push(
      `html[data-accent="${id}"]:not(.dark) {\n${declarations(
        accentCssVars(ACCENT_STATES[id].light),
      )}\n}`,
    );
    chunks.push(
      `html.dark[data-accent="${id}"] {\n${declarations(accentCssVars(ACCENT_STATES[id].dark))}\n}`,
    );
  }

  for (const id of CANVAS_IDS) {
    chunks.push(
      `html[data-canvas="${id}"]:not(.dark) {\n${declarations(canvasDeclarations(id))}\n}`,
    );
  }

  return chunks.join("\n\n");
}

/** `theme-color` / 原生窗口底色等需要具体 hex 时的取值。 */
export function themeColorHex(scheme: ThemeScheme): string {
  return THEME[scheme]["bg-canvas"];
}

/** 无障碍对比度工具：`#rrggbb` / `#rgb` → RGB。 */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
