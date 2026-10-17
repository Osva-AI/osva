import { randomUUID } from "node:crypto";

import { USER_STATUSES, type UserId } from "@osva-ai/contracts";
import { User } from "@osva/domain";
import {
  createDatabase,
  migrateDatabase,
  PostgresUserRepository,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BetterAuthHumanAuthenticationService,
  BetterAuthOperatorPasswordTokenService,
  createOsvaBetterAuth,
} from "../../src/index.js";
import {
  HUMAN_SESSION_ABSOLUTE_LIFETIME_MS,
  effectiveHumanSessionExpiresAt,
} from "../../src/human-session-lifetime.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";

const AUTH_SECRET = "integration-test-auth-secret-with-length-32";
const ORIGIN = "http://127.0.0.1:38431";
const NOW = new Date("2026-01-15T12:00:00.000Z");
const PASSWORD = "Session-Lifetime-Password-12!";

describe("human session lifetime integration", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let humanAuthentication: BetterAuthHumanAuthenticationService;
  let passwordTokens: BetterAuthOperatorPasswordTokenService;
  let users: PostgresUserRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
    });
    await migrateDatabase(database);

    users = new PostgresUserRepository(database);
    const auth = createOsvaBetterAuth({
      database,
      secret: AUTH_SECRET,
      baseURL: ORIGIN,
      trustedOrigins: [ORIGIN],
      disableSessionCookieCache: true,
      sessionUpdateAgeSeconds: 0,
    });
    humanAuthentication = new BetterAuthHumanAuthenticationService({
      auth,
      database,
      users,
    });
    passwordTokens = new BetterAuthOperatorPasswordTokenService({
      database,
      secret: AUTH_SECRET,
      baseURL: ORIGIN,
      trustedOrigins: [ORIGIN],
    });
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  async function provisionAndSignIn(
    email: string,
  ): Promise<{ sessionId: string; sessionToken: string }> {
    const user = User.create({
      id: randomUUID() as UserId,
      email,
      displayName: "Session User",
      status: USER_STATUSES.PENDING_SETUP,
      createdAt: NOW,
    });
    await users.save(user);
    const issued = await passwordTokens.issuePasswordResetToken({
      email,
      redirectTo: `${ORIGIN}/v1/auth/setup/complete`,
    });
    await humanAuthentication.completeInitialSetupWithToken({
      token: issued.token,
      newPassword: PASSWORD,
    });
    const signIn = await humanAuthentication.signInWithEmail({
      email,
      password: PASSWORD,
    });
    return { sessionId: signIn.sessionId, sessionToken: signIn.sessionToken };
  }

  async function readSessionRow(sessionId: string): Promise<{
    createdAt: Date;
    expiresAt: Date;
    updatedAt: Date;
  } | null> {
    const rows = await database.sql<
      {
        created_at: Date;
        expires_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT created_at, expires_at, updated_at
      FROM auth_sessions
      WHERE id = ${sessionId}
    `;
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  it("keeps created_at immutable when Better Auth refreshes idle expiry after updateAge", async () => {
    const { sessionId, sessionToken } = await provisionAndSignIn(
      "session-refresh@example.com",
    );
    const before = await readSessionRow(sessionId);
    expect(before).not.toBeNull();

    await database.sql`
      UPDATE auth_sessions
      SET updated_at = created_at + interval '1 second'
      WHERE id = ${sessionId}
    `;

    const snapshot = await humanAuthentication.getSession(sessionToken);
    expect(snapshot).not.toBeNull();

    const after = await readSessionRow(sessionId);
    expect(after).not.toBeNull();
    expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    expect(after!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before!.expiresAt.getTime(),
    );

    const absoluteCap = new Date(
      before!.createdAt.getTime() + HUMAN_SESSION_ABSOLUTE_LIFETIME_MS,
    );
    expect(snapshot!.expiresAt.getTime()).toBeLessThanOrEqual(
      absoluteCap.getTime(),
    );
    expect(snapshot!.expiresAt.getTime()).toBe(
      effectiveHumanSessionExpiresAt(
        after!.expiresAt,
        before!.createdAt,
      ).getTime(),
    );
  });

  it("rejects sessions at the seven-day absolute boundary and deletes the session row", async () => {
    const { sessionId, sessionToken } = await provisionAndSignIn(
      "absolute-boundary@example.com",
    );
    expect(await readSessionRow(sessionId)).not.toBeNull();

    await database.sql`
      UPDATE auth_sessions
      SET
        created_at = now() - interval '7 days' - interval '1 second',
        expires_at = now() + interval '12 hours',
        updated_at = now()
      WHERE id = ${sessionId}
    `;

    expect(await humanAuthentication.getSession(sessionToken)).toBeNull();
    expect(await readSessionRow(sessionId)).toBeNull();
  });
});
