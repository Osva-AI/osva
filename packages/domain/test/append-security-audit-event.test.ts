import type { SecurityAuditEventId, WorkspaceId } from "@osva-ai/contracts";
import { SECURITY_AUDIT_EVENT_TYPES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { appendSecurityAuditEvent } from "../src/append-security-audit-event.js";
import { SecurityAuditEvent } from "../src/security-audit-event.js";
import type { SecurityAuditEventRepository } from "../src/ports/security-audit-event-repository.js";
import { workspaceId } from "./fixtures.js";

class MemorySecurityAuditRepository implements SecurityAuditEventRepository {
  readonly events: SecurityAuditEvent[] = [];

  async append(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async listForWorkspace(): Promise<readonly SecurityAuditEvent[]> {
    return this.events;
  }
}

describe("appendSecurityAuditEvent", () => {
  it("persists workspace-scoped audit records without secrets", async () => {
    const repository = new MemorySecurityAuditRepository();
    const id = "audit-1" as SecurityAuditEventId;
    const event = SecurityAuditEvent.create({
      id,
      eventType: SECURITY_AUDIT_EVENT_TYPES.APPROVAL_REQUEST_DECIDED,
      occurredAt: new Date("2026-01-15T12:00:00.000Z"),
      workspaceId: workspaceId as WorkspaceId,
      details: {
        approvalRequestId: "approval-1",
        decision: "APPROVED",
      },
    });

    await appendSecurityAuditEvent({ repository, event });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.eventType).toBe(
      SECURITY_AUDIT_EVENT_TYPES.APPROVAL_REQUEST_DECIDED,
    );
  });
});
