import { randomUUID } from "node:crypto";

import {
  SECURITY_AUDIT_EVENT_TYPES,
  type SecurityAuditEventId,
} from "@osva-ai/contracts";
import { normalizeUserEmail } from "@osva-ai/contracts";
import { SecurityAuditEvent } from "@osva/domain";
import {
  createIdentityRuntime,
  recoveryCompleteRedirectUrl,
} from "./identity-runtime.js";
import { parseRecoverCliArgs } from "./parse-cli-args.js";

const args = parseRecoverCliArgs(process.argv.slice(2));

if (args.email.length === 0) {
  console.error(
    [
      "Usage: pnpm identity:recover -- --email owner@example.com",
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
    .then(async () => {
      const user = await runtime.users.findByEmail(email);
      if (user === null) {
        throw new Error("Recovery could not be completed for that request.");
      }

      await runtime.sessions.revokeAllSessionsForUser(user.id);

      const issued = await runtime.passwordTokens.issuePasswordResetToken({
        email,
        redirectTo: recoveryCompleteRedirectUrl(runtime.config.authBaseUrl),
      });

      await runtime.securityAuditEvents.append(
        SecurityAuditEvent.create({
          id: randomUUID() as SecurityAuditEventId,
          eventType: SECURITY_AUDIT_EVENT_TYPES.USER_PASSWORD_RESET_REQUESTED,
          occurredAt: new Date(),
          actorUserId: user.id,
          details: { purpose: "operator_recovery" },
        }),
      );

      process.stdout.write(
        [
          "OSVA identity recovery token issued.",
          "",
          "One-time recovery token (single use; do not log or share):",
          issued.token,
          "",
          `Complete recovery: POST ${recoveryCompleteRedirectUrl(runtime.config.authBaseUrl)}`,
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
