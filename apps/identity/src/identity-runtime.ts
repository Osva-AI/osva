import { randomUUID } from "node:crypto";

import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import {
  createDatabase,
  migrateDatabase,
  PostgresAuthSessionRepository,
  PostgresIdentityLifecycleRepository,
  PostgresOrganizationRepository,
  PostgresSecurityAuditEventRepository,
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import type { HumanSessionRevocationRepository } from "@osva/domain";
import { IdentityBootstrapApplication } from "@osva/domain";

import {
  loadIdentityOperatorConfig,
  type IdentityOperatorConfig,
} from "./operator-config.js";

export interface IdentityRuntime {
  readonly config: IdentityOperatorConfig;
  readonly database: Database;
  readonly bootstrap: IdentityBootstrapApplication;
  readonly passwordTokens: BetterAuthOperatorPasswordTokenService;
  readonly users: PostgresUserRepository;
  readonly sessions: HumanSessionRevocationRepository;
  readonly securityAuditEvents: PostgresSecurityAuditEventRepository;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export function createIdentityRuntime(
  env: NodeJS.ProcessEnv = process.env,
): IdentityRuntime {
  const config = loadIdentityOperatorConfig(env);
  const database = createDatabase({
    connectionString: config.databaseUrl,
    max: 1,
  });
  const clock = { now: () => new Date() };
  const ids = { createId: () => randomUUID() };

  const passwordTokens = new BetterAuthOperatorPasswordTokenService({
    database,
    secret: config.authSecret,
    baseURL: config.authBaseUrl,
    trustedOrigins: [config.authBaseUrl],
  });

  const users = new PostgresUserRepository(database);
  const sessions = new PostgresAuthSessionRepository(database);
  const securityAuditEvents = new PostgresSecurityAuditEventRepository(
    database,
  );

  const bootstrap = new IdentityBootstrapApplication({
    organizations: new PostgresOrganizationRepository(database),
    users,
    workspaces: new PostgresWorkspaceRepository(database),
    workspaceMemberships: new PostgresWorkspaceMembershipRepository(database),
    lifecycle: new PostgresIdentityLifecycleRepository(database),
    securityAuditEvents,
    clock,
    ids,
  });

  return {
    config,
    database,
    bootstrap,
    passwordTokens,
    users,
    sessions,
    securityAuditEvents,
    async migrate() {
      await migrateDatabase(database);
    },
    async close() {
      await database.close();
    },
  };
}

export function setupCompleteRedirectUrl(authBaseUrl: string): string {
  return `${authBaseUrl}/v1/auth/setup/complete`;
}

export function recoveryCompleteRedirectUrl(authBaseUrl: string): string {
  return `${authBaseUrl}/v1/auth/recovery/complete`;
}
