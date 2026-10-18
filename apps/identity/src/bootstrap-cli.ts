import { randomUUID } from "node:crypto";

import {
  SECURITY_AUDIT_EVENT_TYPES,
  type SecurityAuditEventId,
} from "@osva-ai/contracts";
import { normalizeUserEmail } from "@osva-ai/contracts";
import { SecurityAuditEvent } from "@osva/domain";

import {
  createIdentityRuntime,
  setupCompleteRedirectUrl,
} from "./identity-runtime.js";
import { parseBootstrapCliArgs } from "./parse-cli-args.js";

const args = parseBootstrapCliArgs(process.argv.slice(2));

if (
  args.email.length === 0 ||
  (!args.allUnlinkedWorkspaces && args.workspaceIds.length === 0)
) {
  console.error(
    [
      "Usage: pnpm identity:bootstrap -- \\",
      "  --email owner@example.com \\",
      '  --name "Initial Owner" \\',
      '  --organization-name "Default Organization" \\',
      "  --workspace-id <workspace-id> [--workspace-id ...]",
      "  # or: --all-unlinked-workspaces",
      "",
      "Requires OSVA_DATABASE_URL and OSVA_AUTH_SECRET (>= 32 chars).",
      "Optional: OSVA_AUTH_BASE_URL (defaults to http://127.0.0.1:3000).",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  const runtime = createIdentityRuntime();
  const email = normalizeUserEmail(args.email);

  runtime
    .migrate()
    .then(async () =>
      runtime.bootstrap.bootstrapExistingInstallation({
        organizationName: args.organizationName,
        ownerEmail: email,
        ownerDisplayName: args.name,
        workspaceIds: args.workspaceIds,
        allUnlinkedWorkspaces: args.allUnlinkedWorkspaces,
      }),
    )
    .then(async (result) => {
      const issued = await runtime.passwordTokens.issuePasswordResetToken({
        email,
        redirectTo: setupCompleteRedirectUrl(runtime.config.authBaseUrl),
      });

      await runtime.securityAuditEvents.append(
        SecurityAuditEvent.create({
          id: randomUUID() as SecurityAuditEventId,
          eventType: SECURITY_AUDIT_EVENT_TYPES.USER_PASSWORD_RESET_REQUESTED,
          occurredAt: new Date(),
          organizationId: result.organizationId,
          actorUserId: result.ownerUserId,
          details: { purpose: "initial_setup" },
        }),
      );

      process.stdout.write(
        [
          "OSVA identity bootstrap completed.",
          `Organization ID: ${result.organizationId}`,
          `Owner user ID: ${result.ownerUserId}`,
          `Linked workspaces: ${result.linkedWorkspaceIds.join(", ")}`,
          "",
          "One-time password setup token (single use; do not log or share):",
          issued.token,
          "",
          `Complete setup: POST ${setupCompleteRedirectUrl(runtime.config.authBaseUrl)}`,
          'Body: { "token": "<token>", "password": "<new-password>" }',
          "",
        ].join("\n"),
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await runtime.close();
    });
}
