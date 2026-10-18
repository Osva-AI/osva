import type { UserId } from "@osva-ai/contracts";
import { USER_STATUSES, type UserStatus } from "@osva-ai/contracts";
import type {
  HumanAuthenticationService,
  HumanSessionSnapshot,
  HumanSignInResult,
  HumanSignInWithEmailCommand,
} from "@osva/domain";
import type { UserRepository } from "@osva/domain";
import { UserNotFoundError } from "@osva/domain";
import { eq } from "drizzle-orm";

import type { Database } from "@osva/db";
import { authSessions, users } from "@osva/db";

import type { OsvaBetterAuth } from "./create-osva-better-auth.js";
import {
  effectiveHumanSessionExpiresAt,
  isHumanSessionExpiredByEffectiveDeadline,
} from "./human-session-lifetime.js";
import { resolveUserIdForPasswordResetToken } from "./password-reset-token.js";

export interface BetterAuthHumanAuthenticationServiceDependencies {
  readonly auth: OsvaBetterAuth;
  readonly database: Database;
  readonly users: UserRepository;
}

export class BetterAuthHumanAuthenticationService implements HumanAuthenticationService {
  constructor(
    private readonly deps: BetterAuthHumanAuthenticationServiceDependencies,
  ) {}

  async signInWithEmail(
    command: HumanSignInWithEmailCommand,
  ): Promise<HumanSignInResult> {
    const response = await this.deps.auth.api.signInEmail({
      body: {
        email: command.email,
        password: command.password,
      },
      asResponse: true,
    });

    if (!response.ok) {
      throw new Error("Invalid email or password.");
    }

    const sessionToken = readSessionTokenFromSetCookie(
      response.headers.get("set-cookie"),
    );
    if (sessionToken === undefined) {
      throw new Error("Sign-in did not return a session cookie.");
    }

    const session = await this.deps.auth.api.getSession({
      headers: sessionHeaders(sessionToken),
    });
    if (!session?.session || !session.user) {
      throw new Error("Session missing after sign-in.");
    }

    const snapshot = await this.resolveSessionSnapshot(
      sessionToken,
      session.session.id,
      session.user.id as UserId,
      new Date(session.session.expiresAt),
    );
    if (snapshot === null) {
      throw new Error("Session missing after sign-in.");
    }

    return {
      userId: snapshot.userId,
      sessionId: snapshot.sessionId,
      sessionToken,
      expiresAt: snapshot.expiresAt,
    };
  }

  async signOut(sessionToken: string): Promise<void> {
    await this.deps.auth.api.signOut({
      headers: sessionHeaders(sessionToken),
    });
  }

  async getSession(sessionToken: string): Promise<HumanSessionSnapshot | null> {
    const session = await this.deps.auth.api.getSession({
      headers: sessionHeaders(sessionToken),
    });
    if (!session?.session || !session.user) {
      return null;
    }

    return this.resolveSessionSnapshot(
      sessionToken,
      session.session.id,
      session.user.id as UserId,
      new Date(session.session.expiresAt),
    );
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.deps.auth.api.requestPasswordReset({
      body: { email, redirectTo: "/" },
    });
  }

  async resetPassword(input: {
    readonly token: string;
    readonly newPassword: string;
  }): Promise<void> {
    const userId = await resolveUserIdForPasswordResetToken(
      this.deps.database,
      input.token,
    );
    if (userId === null) {
      throw new Error("Invalid or expired recovery token.");
    }
    await this.assertRecoveryEligible(userId);

    const response = await this.deps.auth.api.resetPassword({
      body: {
        token: input.token,
        newPassword: input.newPassword,
      },
      asResponse: true,
    });
    if (!response.ok) {
      throw new Error("Invalid or expired recovery token.");
    }

    await this.deps.database.db
      .delete(authSessions)
      .where(eq(authSessions.userId, userId));

    await this.ensureUserStatus(userId, USER_STATUSES.ACTIVE);
  }

  async completeInitialSetupWithToken(input: {
    readonly token: string;
    readonly newPassword: string;
  }): Promise<void> {
    const userId = await resolveUserIdForPasswordResetToken(
      this.deps.database,
      input.token,
    );
    if (userId === null) {
      throw new Error("Invalid or expired setup token.");
    }
    await this.assertSetupEligible(userId);

    const response = await this.deps.auth.api.resetPassword({
      body: {
        token: input.token,
        newPassword: input.newPassword,
      },
      asResponse: true,
    });
    if (!response.ok) {
      throw new Error("Invalid or expired setup token.");
    }

    await this.deps.database.db
      .update(users)
      .set({
        status: USER_STATUSES.ACTIVE,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async completeInitialSetup(input: {
    readonly userId: UserId;
    readonly displayName: string;
    readonly newPassword: string;
  }): Promise<void> {
    const user = await this.deps.users.findById(input.userId);
    if (user === null) {
      throw new UserNotFoundError(input.userId);
    }

    await this.deps.database.db
      .update(users)
      .set({
        displayName: input.displayName.trim(),
        status: USER_STATUSES.ACTIVE,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));

    await this.deps.auth.api.setPassword({
      body: { newPassword: input.newPassword },
      headers: await this.sessionHeadersForUser(input.userId),
    });
  }

  private async assertSetupEligible(userId: UserId): Promise<void> {
    const status = await this.readUserStatus(userId);
    if (status === USER_STATUSES.DISABLED) {
      throw new Error("Disabled users cannot complete setup.");
    }
    if (status !== USER_STATUSES.PENDING_SETUP) {
      throw new Error(
        "Setup tokens apply only to users awaiting initial password setup.",
      );
    }
  }

  private async assertRecoveryEligible(userId: UserId): Promise<void> {
    const status = await this.readUserStatus(userId);
    if (status === USER_STATUSES.DISABLED) {
      throw new Error(
        "Disabled users cannot reset passwords through recovery.",
      );
    }
    if (status === USER_STATUSES.PENDING_SETUP) {
      throw new Error(
        "Pending setup users must complete initial setup instead of recovery.",
      );
    }
    if (status !== USER_STATUSES.ACTIVE) {
      throw new Error("Recovery is only available for active users.");
    }
  }

  private async readUserStatus(userId: UserId): Promise<UserStatus> {
    const user = await this.deps.users.findById(userId);
    if (user === null) {
      throw new Error("User not found.");
    }
    return user.status;
  }

  private async ensureUserStatus(
    userId: UserId,
    status: UserStatus,
  ): Promise<void> {
    await this.deps.database.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  private async resolveSessionSnapshot(
    sessionToken: string,
    sessionId: string,
    userId: UserId,
    idleExpiresAt: Date,
  ): Promise<HumanSessionSnapshot | null> {
    const rows = await this.deps.database.db
      .select({ createdAt: authSessions.createdAt })
      .from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .limit(1);
    const createdAt = rows[0]?.createdAt;
    if (createdAt === undefined) {
      return null;
    }

    if (isHumanSessionExpiredByEffectiveDeadline(idleExpiresAt, createdAt)) {
      await this.signOut(sessionToken);
      return null;
    }

    return {
      userId,
      sessionId,
      expiresAt: effectiveHumanSessionExpiresAt(idleExpiresAt, createdAt),
    };
  }

  private async sessionHeadersForUser(userId: UserId): Promise<Headers> {
    const rows = await this.deps.database.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
      .limit(1);
    const token = rows[0]?.token;
    if (token === undefined) {
      throw new Error("Active session required to complete setup.");
    }
    return sessionHeaders(token);
  }
}

function sessionHeaders(sessionToken: string): Headers {
  const headers = new Headers();
  headers.set("cookie", `${sessionCookieName()}=${sessionToken}`);
  return headers;
}

function sessionCookieName(): string {
  return "osva.session_token";
}

function readSessionTokenFromSetCookie(
  setCookie: string | null,
): string | undefined {
  if (setCookie === null) {
    return undefined;
  }
  const prefix = `${sessionCookieName()}=`;
  for (const part of setCookie.split(",")) {
    const segment = part.trim();
    if (segment.startsWith(prefix)) {
      const raw = segment.slice(prefix.length).split(";")[0] ?? "";
      return decodeURIComponent(raw);
    }
  }
  return undefined;
}

export function readSessionTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return undefined;
  }

  const prefix = `${sessionCookieName()}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return undefined;
}

export function sessionHeadersFromIncoming(
  cookieHeader: string | undefined,
): Headers {
  const token = readSessionTokenFromCookieHeader(cookieHeader);
  if (token === undefined) {
    return new Headers();
  }
  return sessionHeaders(token);
}

export { fromNodeHeaders } from "better-auth/node";
