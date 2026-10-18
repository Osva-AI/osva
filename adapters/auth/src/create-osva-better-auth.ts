import type { Database } from "@osva/db";
import { USER_STATUSES } from "@osva-ai/contracts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { osvaBetterAuthDrizzleSchema } from "./osva-better-auth-schema.js";

export interface ResetPasswordTokenPayload {
  readonly token: string;
  readonly url: string;
}

export interface CreateOsvaBetterAuthOptions {
  readonly database: Database;
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins: readonly string[];
  readonly onResetPasswordToken?: (
    payload: ResetPasswordTokenPayload,
  ) => void | Promise<void>;
  /** Test hook: disable in-memory session cookie cache so DB refresh behavior is observable. */
  readonly disableSessionCookieCache?: boolean;
  /** Override session updateAge (seconds) for integration tests. */
  readonly sessionUpdateAgeSeconds?: number;
}

export function createOsvaBetterAuth(options: CreateOsvaBetterAuthOptions) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.database.db, {
      provider: "pg",
      schema: osvaBetterAuthDrizzleSchema,
      camelCase: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ token, url }) => {
        await options.onResetPasswordToken?.({ token, url });
      },
    },
    user: {
      fields: {
        name: "displayName",
        /** Better Auth expects `image`; OSVA stores no avatar — map to nullable column. */
        image: "image",
      },
      additionalFields: {
        status: {
          type: "string",
          required: true,
          defaultValue: USER_STATUSES.PENDING_SETUP,
          input: false,
        },
      },
    },
    session: {
      /** Idle timeout: extended on activity at most every updateAge. */
      expiresIn: 60 * 60 * 12,
      updateAge: options.sessionUpdateAgeSeconds ?? 60 * 5,
      cookieCache: {
        enabled: options.disableSessionCookieCache !== true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      cookiePrefix: "osva",
      useSecureCookies: options.baseURL.startsWith("https://"),
    },
  });
}

export type OsvaBetterAuth = ReturnType<typeof createOsvaBetterAuth>;
