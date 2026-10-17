import { describe, expect, it } from "vitest";

import {
  HUMAN_SESSION_ABSOLUTE_LIFETIME_MS,
  absoluteSessionDeadline,
  effectiveHumanSessionExpiresAt,
  isHumanSessionExpiredByEffectiveDeadline,
} from "../src/human-session-lifetime.js";

describe("human session lifetime", () => {
  const authenticatedAt = new Date("2026-01-01T00:00:00.000Z");

  it("caps effective expiry at seven days from authentication", () => {
    const idle = new Date("2026-01-20T00:00:00.000Z");
    const effective = effectiveHumanSessionExpiresAt(idle, authenticatedAt);
    expect(effective.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(absoluteSessionDeadline(authenticatedAt).getTime()).toBe(
      authenticatedAt.getTime() + HUMAN_SESSION_ABSOLUTE_LIFETIME_MS,
    );
  });

  it("uses idle expiry when it is earlier than the absolute cap", () => {
    const idle = new Date("2026-01-01T06:00:00.000Z");
    expect(effectiveHumanSessionExpiresAt(idle, authenticatedAt)).toEqual(idle);
  });

  it("treats sessions as expired once the effective deadline has passed", () => {
    const idle = new Date("2026-01-20T00:00:00.000Z");
    expect(
      isHumanSessionExpiredByEffectiveDeadline(
        idle,
        authenticatedAt,
        new Date("2026-01-08T00:00:01.000Z"),
      ),
    ).toBe(true);
    expect(
      isHumanSessionExpiredByEffectiveDeadline(
        idle,
        authenticatedAt,
        new Date("2026-01-07T23:59:59.000Z"),
      ),
    ).toBe(false);
  });
});
