import { afterEach, describe, expect, it } from "vitest";

import {
  HOME_PRESENTATION_PREFERENCE_STORAGE_KEY,
  readHomePresentationPreference,
  writeHomePresentationPreference,
} from "../src/client/lib/home-presentation-preference";

describe("home presentation preference", () => {
  afterEach(() => {
    localStorage.removeItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY);
  });

  it("defaults to standard", () => {
    expect(readHomePresentationPreference()).toBe("standard");
  });

  it("persists advanced preference", () => {
    writeHomePresentationPreference("advanced");
    expect(readHomePresentationPreference()).toBe("advanced");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY, "expert");
    expect(readHomePresentationPreference()).toBe("standard");
  });
});
