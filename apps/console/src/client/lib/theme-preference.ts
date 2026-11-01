export const THEME_PREFERENCE_STORAGE_KEY = "osva.console.themePreference";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const VALID_PREFERENCES: readonly ThemePreference[] = [
  "light",
  "dark",
  "system",
];

export function readThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const raw = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)?.trim();
  if (
    raw !== undefined &&
    (VALID_PREFERENCES as readonly string[]).includes(raw)
  ) {
    return raw as ThemePreference;
  }
  return "system";
}

export function writeThemePreference(preference: ThemePreference): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
}

export function resolveThemePreference(
  preference: ThemePreference,
  prefersLight: boolean,
): ResolvedTheme {
  if (preference === "light") {
    return "light";
  }
  if (preference === "dark") {
    return "dark";
  }
  return prefersLight ? "light" : "dark";
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function syncThemeFromPreference(
  preference: ThemePreference = readThemePreference(),
): ResolvedTheme {
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  const resolved = resolveThemePreference(preference, prefersLight);
  applyResolvedTheme(resolved);
  return resolved;
}

export function subscribeToSystemColorScheme(
  onChange: (resolved: ResolvedTheme) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handler = (): void => {
    if (readThemePreference() !== "system") {
      return;
    }
    onChange(syncThemeFromPreference("system"));
  };
  media.addEventListener("change", handler);
  return () => {
    media.removeEventListener("change", handler);
  };
}
