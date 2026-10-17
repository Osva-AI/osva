/** Wall-clock cap from original session creation (login), independent of idle sliding. */
export const HUMAN_SESSION_ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function absoluteSessionDeadline(authenticatedAt: Date): Date {
  return new Date(
    authenticatedAt.getTime() + HUMAN_SESSION_ABSOLUTE_LIFETIME_MS,
  );
}

/** Earlier of Better Auth idle sliding expiry and the seven-day absolute cap. */
export function effectiveHumanSessionExpiresAt(
  idleExpiresAt: Date,
  authenticatedAt: Date,
): Date {
  const absolute = absoluteSessionDeadline(authenticatedAt);
  return idleExpiresAt.getTime() <= absolute.getTime()
    ? idleExpiresAt
    : absolute;
}

export function isHumanSessionExpiredByEffectiveDeadline(
  idleExpiresAt: Date,
  authenticatedAt: Date,
  now: Date = new Date(),
): boolean {
  return (
    effectiveHumanSessionExpiresAt(idleExpiresAt, authenticatedAt).getTime() <=
    now.getTime()
  );
}
