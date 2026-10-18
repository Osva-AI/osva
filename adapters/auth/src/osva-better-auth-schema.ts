import { authAccounts, authSessions, authVerifications, users } from "@osva/db";

export const osvaBetterAuthDrizzleSchema = {
  user: users,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
} as const;
