import type { UserId } from "@osva-ai/contracts";

export interface HumanSessionRevocationRepository {
  revokeAllSessionsForUser(userId: UserId): Promise<void>;
}
