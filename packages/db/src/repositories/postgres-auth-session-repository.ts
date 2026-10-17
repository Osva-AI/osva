import type { UserId } from "@osva-ai/contracts";
import type { HumanSessionRevocationRepository } from "@osva/domain";
import { eq } from "drizzle-orm";

import type { Database } from "../database.js";
import { authSessions } from "../schema/auth-sessions.js";

export class PostgresAuthSessionRepository implements HumanSessionRevocationRepository {
  constructor(private readonly database: Database) {}

  async revokeAllSessionsForUser(userId: UserId): Promise<void> {
    await this.database.db
      .delete(authSessions)
      .where(eq(authSessions.userId, userId));
  }
}
