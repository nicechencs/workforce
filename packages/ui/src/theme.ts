/**
 * 主题偏好的读写与落地。
 *
 * 真源同 tokens.ts：这里只负责选择 `light | dark | system`、accent 和 canvas，
 * 并把结果写到 `html` 的 class / data 属性上。色值一律来自 CSS 变量，
 * 本模块不出现 hex。
 *
 * 存储键与 AgentHub 同名风格但独立命名空间，避免两个产品串档。
 */

import {
  DEFAULT_ACCENT_ID,
  DEFAULT_CANVAS_ID,
  isAccentId,
  isCanvasId,
  type AccentId,
  type CanvasId,
  type ThemeScheme,
} from "./tokens.js";

export const THEME_STORAGE_KEYS = {
  mode: "workforce:theme",
  accent: "workforce:accent",
  canvas: "workforce:canvas",
} as const;

export type ThemeMode = "light" | "dark" | "system";

export const THEME_MODES = ["light", "dark", "system"] as const;

export interface ThemePreferences {
  mode: ThemeMode;
  accent: AccentId;
  canvas: CanvasId;
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: "system",
  accent: DEFAULT_ACCENT_ID,
  canvas: DEFAULT_CANVAS_ID,
};

/** 最小存储接口：localStorage 兼容，测试可注入内存实现。 */
export interface ThemeStorage {
  getItem(key: string): string | null;
}

export function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value);
}

function pickMode(value: string | null): ThemeMode {
  return value !== null && isThemeMode(value) ? value : DEFAULT_THEME_PREFERENCES.mode;
}

function pickAccent(value: string | null): AccentId {
  return value !== null && isAccentId(value) ? value : DEFAULT_THEME_PREFERENCES.accent;
}

function pickCanvas(value: string | null): CanvasId {
  return value !== null && isCanvasId(value) ? value : DEFAULT_THEME_PREFERENCES.canvas;
}

/** 读取偏好。缺字段或非法值回退默认，不抛错。 */
export function readThemePreferences(storage: ThemeStorage | null): ThemePreferences {
  if (!storage) {
    return DEFAULT_THEME_PREFERENCES;
  }
  try {
    return {
      mode: pickMode(storage.getItem(THEME_STORAGE_KEYS.mode)),
      accent: pickAccent(storage.getItem(THEME_STORAGE_KEYS.accent)),
      canvas: pickCanvas(storage.getItem(THEME_STORAGE_KEYS.canvas)),
    };
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(
  storage: Pick<Storage, "setItem"> | null,
  preferences: ThemePreferences,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(THEME_STORAGE_KEYS.mode, preferences.mode);
    storage.setItem(THEME_STORAGE_KEYS.accent, preferences.accent);
    storage.setItem(THEME_STORAGE_KEYS.canvas, preferences.canvas);
  } catch {
    // 存储不可用（隐私模式 / 配额）时主题仍生效，只是不持久化。
  }
}

/** `system` 跟随操作系统，其它模式直接返回自身。 */
export function resolveThemeScheme(mode: ThemeMode, prefersDark: boolean): ThemeScheme {
  if (mode === "system") {
    return prefersDark ? "dark" : "light";
  }
  return mode;
}

export type ThemeTarget = {
  classList: { toggle(token: string, force?: boolean): unknown };
  setAttribute(name: string, value: string): void;
};

/** 把解析后的主题写到 `<html>`：`.light` / `.dark` + `data-accent` + `data-canvas`。 */
export function applyTheme(
  target: ThemeTarget,
  preferences: ThemePreferences,
  scheme: ThemeScheme,
): void {
  const dark = scheme === "dark";
  target.classList.toggle("dark", dark);
  target.classList.toggle("light", !dark);
  target.setAttribute("data-accent", preferences.accent);
  target.setAttribute("data-canvas", preferences.canvas);
}

/** 浏览器窗口是否偏好深色；无 `matchMedia` 时按浅色处理。 */
export function prefersDarkScheme(view: {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
}): boolean {
  const query = view.matchMedia?.("(prefers-color-scheme: dark)");
  return query?.matches === true;
}
