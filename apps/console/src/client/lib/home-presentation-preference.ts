export const HOME_PRESENTATION_PREFERENCE_STORAGE_KEY =
  "osva.console.homePresentation.v1";

export type HomePresentationPreference = "standard" | "advanced";

const VALID_PREFERENCES: readonly HomePresentationPreference[] = [
  "standard",
  "advanced",
];

export function readHomePresentationPreference(): HomePresentationPreference {
  if (typeof localStorage === "undefined") {
    return "standard";
  }
  const raw = localStorage
    .getItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY)
    ?.trim();
  if (
    raw !== undefined &&
    (VALID_PREFERENCES as readonly string[]).includes(raw)
  ) {
    return raw as HomePresentationPreference;
  }
  return "standard";
}

export function writeHomePresentationPreference(
  preference: HomePresentationPreference,
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY, preference);
}

export const HOME_PRESENTATION_PREFERENCE_EVENT =
  "osva-home-presentation-preference";

export function notifyHomePresentationPreferenceChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(HOME_PRESENTATION_PREFERENCE_EVENT));
}
