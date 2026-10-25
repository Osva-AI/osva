import type { SecurityAuditEventId } from "@osva-ai/contracts";

import type { SecurityAuditEvent } from "./security-audit-event.js";
import type { SecurityAuditEventRepository } from "./ports/security-audit-event-repository.js";

export interface AppendSecurityAuditEventInput {
  readonly repository: SecurityAuditEventRepository;
  readonly event: SecurityAuditEvent;
}

/**
 * Persists a security audit record. Failures propagate to the caller so
 * control-plane mutations can avoid claiming durability they did not achieve.
 */
export async function appendSecurityAuditEvent(
  input: AppendSecurityAuditEventInput,
): Promise<SecurityAuditEventId> {
  await input.repository.append(input.event);
  return input.event.id;
}
