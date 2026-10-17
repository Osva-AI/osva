import type { WorkspaceId } from "@osva-ai/contracts";

import type { SecurityAuditEvent } from "../security-audit-event.js";

export interface SecurityAuditEventRepository {
  append(event: SecurityAuditEvent): Promise<void>;
  listForWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly SecurityAuditEvent[]>;
}
