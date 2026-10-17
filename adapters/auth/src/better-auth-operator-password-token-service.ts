import { normalizeUserEmail } from "@osva-ai/contracts";
import type { HumanOperatorPasswordTokenService } from "@osva/domain";

import {
  createOsvaBetterAuth,
  type CreateOsvaBetterAuthOptions,
} from "./create-osva-better-auth.js";

export type BetterAuthOperatorPasswordTokenServiceOptions = Omit<
  CreateOsvaBetterAuthOptions,
  "onResetPasswordToken"
>;

export class BetterAuthOperatorPasswordTokenService implements HumanOperatorPasswordTokenService {
  private readonly auth;
  private capture: { readonly token: string; readonly url: string } | undefined;

  constructor(options: BetterAuthOperatorPasswordTokenServiceOptions) {
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
