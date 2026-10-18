import type { UserId } from "@osva-ai/contracts";

export interface HumanSessionRecord {
  readonly sessionId: string;
  readonly userId: UserId;
  readonly expiresAt: Date;
}

export interface HumanSessionRepository {
  findActiveByToken(
    token: string,
    now: Date,
  ): Promise<HumanSessionRecord | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllForUser(userId: UserId): Promise<void>;
}
