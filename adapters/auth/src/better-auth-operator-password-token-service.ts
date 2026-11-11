import type { UserId } from "@osva-ai/contracts";
import { normalizeUserEmail } from "@osva-ai/contracts";
import type { HumanOperatorPasswordTokenService } from "@osva/domain";
import { eq } from "drizzle-orm";

import type { Database } from "@osva/db";
import { users } from "@osva/db";

import {
  createOsvaBetterAuth,
  type CreateOsvaBetterAuthOptions,
} from "./create-osva-better-auth.js";
import { revokeOutstandingPasswordResetTokensForUser } from "./password-reset-token.js";

export type BetterAuthOperatorPasswordTokenServiceOptions = Omit<
  CreateOsvaBetterAuthOptions,
  "onResetPasswordToken"
>;

export class BetterAuthOperatorPasswordTokenService implements HumanOperatorPasswordTokenService {
  private readonly auth;
  private readonly database: Database;
  private capture: { readonly token: string; readonly url: string } | undefined;

  constructor(options: BetterAuthOperatorPasswordTokenServiceOptions) {
    this.database = options.database;
    this.auth = createOsvaBetterAuth({
      ...options,
      onResetPasswordToken: async ({ token, url }) => {
        this.capture = { token, url };
      },
    });
  }

  async issuePasswordResetToken(input: {
    readonly email: string;
    readonly redirectTo: string;
  }): Promise<{ readonly token: string; readonly url: string }> {
    this.capture = undefined;
    const email = normalizeUserEmail(input.email);
    const [userRow] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (userRow?.id !== undefined) {
      await revokeOutstandingPasswordResetTokensForUser(
        this.database,
        userRow.id as UserId,
      );
    }
    await this.auth.api.requestPasswordReset({
      body: {
        email,
        redirectTo: input.redirectTo,
      },
    });
    if (this.capture === undefined) {
      throw new Error(
        "Password reset token was not issued. Confirm the user exists and email/password auth is enabled.",
      );
    }
    return this.capture;
  }
}
