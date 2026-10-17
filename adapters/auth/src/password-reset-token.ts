import type { UserId } from "@osva-ai/contracts";
import { eq } from "drizzle-orm";

import type { Database } from "@osva/db";
import { authVerifications } from "@osva/db";

export function passwordResetVerificationIdentifier(token: string): string {
  return `reset-password:${token}`;
}

export async function resolveUserIdForPasswordResetToken(
  database: Database,
  token: string,
): Promise<UserId | null> {
  const identifier = passwordResetVerificationIdentifier(token);
  const [row] = await database.db
    .select()
    .from(authVerifications)
    .where(eq(authVerifications.identifier, identifier))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return row.value as UserId;
}
