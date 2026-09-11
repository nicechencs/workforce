import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THEME_PREFERENCES,
  THEME_STORAGE_KEYS,
  applyTheme,
  isThemeMode,
  prefersDarkScheme,
  readThemePreferences,
  resolveThemeScheme,
  writeThemePreferences,
  type ThemeStorage,
} from "./theme.js";

function memoryStorage(seed: Record<string, string> = {}): ThemeStorage & {
  values: Record<string, string>;
} {
  const values = { ...seed };
  return {
    values,
    getItem: (key) => (key in values ? (values[key] as string) : null),
  };
}

describe("theme preferences", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(readThemePreferences(memoryStorage())).toEqual(DEFAULT_THEME_PREFERENCES);
    expect(readThemePreferences(null)).toEqual(DEFAULT_THEME_PREFERENCES);
  });

  it("rejects unknown stored values instead of passing them through", () => {
    const storage = memoryStorage({
      [THEME_STORAGE_KEYS.mode]: "neon",
      [THEME_STORAGE_KEYS.accent]: "cyan",
      [THEME_STORAGE_KEYS.canvas]: "neon",
    });
    expect(readThemePreferences(storage)).toEqual(DEFAULT_THEME_PREFERENCES);
  });

  it("reads valid stored values", () => {
    const storage = memoryStorage({
      [THEME_STORAGE_KEYS.mode]: "dark",
      [THEME_STORAGE_KEYS.accent]: "teal",
      [THEME_STORAGE_KEYS.canvas]: "mist",
    });
    expect(readThemePreferences(storage)).toEqual({
      mode: "dark",
      accent: "teal",
      canvas: "mist",
    });
  });

  it("persists every preference on the same keys it reads", () => {
    const setItem = vi.fn();
    writeThemePreferences({ setItem }, { mode: "light", accent: "rose", canvas: "paper" });
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEYS.mode, "light");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEYS.accent, "rose");
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEYS.canvas, "paper");
  });

  it("does not throw when storage is unavailable", () => {
    expect(() => writeThemePreferences(null, DEFAULT_THEME_PREFERENCES)).not.toThrow();
    expect(() =>
      writeThemePreferences(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        DEFAULT_THEME_PREFERENCES,
      ),
    ).not.toThrow();
  });

  it("resolves system mode from the OS preference", () => {
    expect(resolveThemeScheme("system", true)).toBe("dark");
    expect(resolveThemeScheme("system", false)).toBe("light");
    expect(resolveThemeScheme("dark", false)).toBe("dark");
    expect(resolveThemeScheme("light", true)).toBe("light");
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("blue")).toBe(false);
  });

  it("writes scheme classes and palette attributes onto the target", () => {
    const toggle = vi.fn();
    const setAttribute = vi.fn();
    applyTheme(
      { classList: { toggle }, setAttribute },
      {
        mode: "system",
        accent: "indigo",
        canvas: "mint",
      },
      "dark",
    );
    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(toggle).toHaveBeenCalledWith("light", false);
    expect(setAttribute).toHaveBeenCalledWith("data-accent", "indigo");
    expect(setAttribute).toHaveBeenCalledWith("data-canvas", "mint");
  });

  it("treats a missing matchMedia as light", () => {
    expect(prefersDarkScheme({})).toBe(false);
    expect(prefersDarkScheme({ matchMedia: () => ({ matches: true }) })).toBe(true);
  });
});
