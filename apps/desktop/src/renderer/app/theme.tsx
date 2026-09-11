import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_THEME_PREFERENCES,
  applyTheme,
  prefersDarkScheme,
  readThemePreferences,
  resolveThemeScheme,
  writeThemePreferences,
  type AccentId,
  type CanvasId,
  type ThemeMode,
  type ThemePreferences,
  type ThemeScheme,
} from "@workforce/ui";

/**
 * 主题提供者：把 `@workforce/ui` 的主题偏好模型接到 `html` 上。
 *
 * - `bootstrapTheme()` 在 React 挂载前同步运行，避免首屏闪色。
 * - 偏好写入 localStorage；`system` 模式跟随 `prefers-color-scheme`。
 * - 组件只暴露 mode / accent / canvas，不暴露 hex。
 */

export interface ThemeContextValue extends ThemePreferences {
  scheme: ThemeScheme;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
  setCanvas: (canvas: CanvasId) => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function currentStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 在首屏渲染前同步落地主题，避免浅色闪一下再变深色。 */
export function bootstrapTheme(): void {
  if (typeof document === "undefined") {
    return;
  }
  const preferences = readThemePreferences(currentStorage());
  const dark = typeof window === "undefined" ? false : prefersDarkScheme(window);
  applyTheme(document.documentElement, preferences, resolveThemeScheme(preferences.mode, dark));
}

export function ThemeProvider(props: { children: ReactNode }): ReactNode {
  const [preferences, setPreferences] = useState<ThemePreferences>(() =>
    readThemePreferences(currentStorage()),
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === "undefined" ? false : prefersDarkScheme(window),
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(query.matches);
    };
    setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  const scheme = resolveThemeScheme(preferences.mode, systemDark);

  useEffect(() => {
    if (typeof document !== "undefined") {
      applyTheme(document.documentElement, preferences, scheme);
    }
    writeThemePreferences(currentStorage(), preferences);
  }, [preferences, scheme]);

  const setMode = useCallback((mode: ThemeMode) => {
    setPreferences((current) => ({ ...current, mode }));
  }, []);
  const setAccent = useCallback((accent: AccentId) => {
    setPreferences((current) => ({ ...current, accent }));
  }, []);
  const setCanvas = useCallback((canvas: CanvasId) => {
    setPreferences((current) => ({ ...current, canvas }));
  }, []);
  const reset = useCallback(() => {
    setPreferences(DEFAULT_THEME_PREFERENCES);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ ...preferences, scheme, setMode, setAccent, setCanvas, reset }),
    [preferences, scheme, setMode, setAccent, setCanvas, reset],
  );

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}

/** 顶栏主题切换的最小状态：图标 + 下一档模式。 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  switch (mode) {
    case "light":
      return "dark";
    case "dark":
      return "system";
    case "system":
      return "light";
  }
}

export function themeModeLabel(mode: ThemeMode): string {
  switch (mode) {
    case "light":
      return "浅色";
    case "dark":
      return "深色";
    case "system":
      return "跟随系统";
  }
}
