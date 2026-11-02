import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readThemePreference,
  resolveThemePreference,
  syncThemeFromPreference,
  THEME_PREFERENCE_STORAGE_KEY,
  writeThemePreference,
} from "../src/client/lib/theme-preference";

describe("theme preference", () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
  });

  it("defaults to system when unset", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("persists explicit preferences", () => {
    writeThemePreference("light");
    expect(readThemePreference()).toBe("light");
    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("light");
  });

  it("resolves system preference from color scheme", () => {
    expect(resolveThemePreference("system", true)).toBe("light");
    expect(resolveThemePreference("system", false)).toBe("dark");
  });

  it("applies resolved theme to the document root", () => {
    syncThemeFromPreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    syncThemeFromPreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
