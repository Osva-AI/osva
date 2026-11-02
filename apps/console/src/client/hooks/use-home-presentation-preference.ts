import { useCallback, useSyncExternalStore } from "react";

import {
  HOME_PRESENTATION_PREFERENCE_EVENT,
  readHomePresentationPreference,
  writeHomePresentationPreference,
  notifyHomePresentationPreferenceChanged,
  type HomePresentationPreference,
} from "../lib/home-presentation-preference";

function subscribe(onStoreChange: () => void): () => void {
  const handler = (): void => {
    onStoreChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(HOME_PRESENTATION_PREFERENCE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(HOME_PRESENTATION_PREFERENCE_EVENT, handler);
  };
}

export function useHomePresentationPreference(): {
  readonly preference: HomePresentationPreference;
  readonly setPreference: (preference: HomePresentationPreference) => void;
} {
  const preference = useSyncExternalStore(
    subscribe,
    readHomePresentationPreference,
    () => "standard" as HomePresentationPreference,
  );

  const setPreference = useCallback(
    (next: HomePresentationPreference): void => {
      writeHomePresentationPreference(next);
      notifyHomePresentationPreferenceChanged();
    },
    [],
  );

  return { preference, setPreference };
}
