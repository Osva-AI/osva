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
import { passwordResetVerificationIdentifier } from "../../src/password-reset-token.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";

const AUTH_SECRET = "integration-test-auth-secret-with-length-32";
const ORIGIN = "http://127.0.0.1:38430";
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("human password setup and recovery lifecycle", () => {
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

  async function seedPendingUser(email: string): Promise<UserId> {
    const user = User.create({
      id: randomUUID() as UserId,
      email,
      displayName: "Pending User",
      status: USER_STATUSES.PENDING_SETUP,
      createdAt: NOW,
    });
    await users.save(user);
    return user.id;
  }

  async function seedActiveUser(email: string): Promise<UserId> {
    const user = User.create({
      id: randomUUID() as UserId,
      email,
      displayName: "Active User",
      status: USER_STATUSES.ACTIVE,
      createdAt: NOW,
    });
    await users.save(user);
    return user.id;
  }

  it("activates PENDING_SETUP users through setup token consumption", async () => {
    const email = "pending-setup@example.com";
    await seedPendingUser(email);

    const issued = await passwordTokens.issuePasswordResetToken({
      email,
      redirectTo: `${ORIGIN}/v1/auth/setup/complete`,
    });

    await humanAuthentication.completeInitialSetupWithToken({
      token: issued.token,
      newPassword: "Initial-Password-12!",
    });

    const stored = await users.findByEmail(email);
    expect(stored?.status).toBe(USER_STATUSES.ACTIVE);

    await expect(
      humanAuthentication.completeInitialSetupWithToken({
        token: issued.token,
        newPassword: "Initial-Password-12!",
      }),
    ).rejects.toThrow(/Invalid or expired setup token/);

    const signIn = await humanAuthentication.signInWithEmail({
      email,
      password: "Initial-Password-12!",
    });
    expect(signIn.userId).toBe(stored?.id);
  });

  it("rejects expired setup tokens", async () => {
    const email = "expired-setup@example.com";
    await seedPendingUser(email);
    const issued = await passwordTokens.issuePasswordResetToken({
      email,
      redirectTo: `${ORIGIN}/v1/auth/setup/complete`,
    });

    await database.sql`
      UPDATE auth_verifications
      SET expires_at = ${"2020-01-01T00:00:00.000Z"}
      WHERE identifier = ${passwordResetVerificationIdentifier(issued.token)}
    `;

    await expect(
      humanAuthentication.completeInitialSetupWithToken({
        token: issued.token,
        newPassword: "Initial-Password-12!",
      }),
    ).rejects.toThrow(/Invalid or expired setup token/);
  });

  it("keeps ACTIVE users ACTIVE through recovery and blocks DISABLED recovery", async () => {
    const activeEmail = "active-recover@example.com";
    await seedActiveUser(activeEmail);
    const setupIssued = await passwordTokens.issuePasswordResetToken({
      email: activeEmail,
      redirectTo: `${ORIGIN}/v1/auth/setup/complete`,
    });
    await expect(
      humanAuthentication.completeInitialSetupWithToken({
        token: setupIssued.token,
        newPassword: "Wrong-Flow-12!",
      }),
    ).rejects.toThrow(/awaiting initial password setup/);

    const recoveryIssued = await passwordTokens.issuePasswordResetToken({
      email: activeEmail,
      redirectTo: `${ORIGIN}/v1/auth/recovery/complete`,
    });
    await humanAuthentication.resetPassword({
      token: recoveryIssued.token,
      newPassword: "Recovery-Password-12!",
    });
    const afterRecovery = await users.findByEmail(activeEmail);
    expect(afterRecovery?.status).toBe(USER_STATUSES.ACTIVE);

    const disabledEmail = "disabled-recover@example.com";
    const disabledId = await seedActiveUser(disabledEmail);
    await database.sql`
      UPDATE users SET status = ${USER_STATUSES.DISABLED} WHERE id = ${disabledId}
    `;
    const disabledIssued = await passwordTokens.issuePasswordResetToken({
      email: disabledEmail,
      redirectTo: `${ORIGIN}/v1/auth/recovery/complete`,
    });
    await expect(
      humanAuthentication.resetPassword({
        token: disabledIssued.token,
        newPassword: "Recovery-Password-12!",
      }),
    ).rejects.toThrow(/Disabled users cannot reset passwords/);
  });

  it("persists Better Auth verification rows with user id in value, not token in value", async () => {
    const email = "token-storage@example.com";
    const userId = await seedPendingUser(email);
    const issued = await passwordTokens.issuePasswordResetToken({
      email,
      redirectTo: `${ORIGIN}/v1/auth/setup/complete`,
    });
    const rows = await database.sql<{ identifier: string; value: string }[]>`
      SELECT identifier, value FROM auth_verifications
      WHERE identifier = ${passwordResetVerificationIdentifier(issued.token)}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(userId);
    expect(rows[0]?.value).not.toBe(issued.token);
  });
});
