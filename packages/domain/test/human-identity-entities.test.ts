import {
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
  SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES,
  USER_STATUSES,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { DomainInvariantError } from "../src/errors.js";
import { Organization } from "../src/organization.js";
import { OrganizationMembership } from "../src/organization-membership.js";
import { SecurityAuditEvent } from "../src/security-audit-event.js";
import { User } from "../src/user.js";
import { WorkspaceMembership } from "../src/workspace-membership.js";
import { NOW } from "./fixtures.js";

describe("M11 human identity entities", () => {
  it("creates organization, user, and membership records", () => {
    const organization = Organization.create({
      id: "org-1" as never,
      name: "Acme Org",
      createdAt: NOW,
    });
    const user = User.create({
      id: "user-1" as never,
      email: "Owner@Example.com",
      displayName: "Owner",
      status: USER_STATUSES.ACTIVE,
      createdAt: NOW,
    });

    expect(user.email).toBe("owner@example.com");
    expect(organization.name).toBe("Acme Org");

    const orgMembership = OrganizationMembership.create({
      id: "om-1" as never,
      organizationId: organization.id,
      userId: user.id,
      role: ORGANIZATION_MEMBERSHIP_ROLES.OWNER,
      createdAt: NOW,
    });
    const workspaceMembership = WorkspaceMembership.create({
      id: "wm-1" as never,
      workspaceId: "ws-1" as never,
      userId: user.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      createdAt: NOW,
    });

    expect(orgMembership.role).toBe(ORGANIZATION_MEMBERSHIP_ROLES.OWNER);
    expect(workspaceMembership.role).toBe(HUMAN_WORKSPACE_ROLES.OWNER);
    expect(Object.isFrozen(workspaceMembership)).toBe(true);
  });

  it("rejects invalid user email", () => {
    expect(() =>
      User.create({
        id: "user-1" as never,
        email: "not-an-email",
        displayName: "Owner",
        status: USER_STATUSES.ACTIVE,
        createdAt: NOW,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("stores JSON-safe security audit details", () => {
    const event = SecurityAuditEvent.create({
      id: "audit-1" as never,
      eventType: "user.created" as never,
      occurredAt: NOW,
      details: { userId: "user-1" },
    });

    expect(event.details).toEqual({ userId: "user-1" });
    expect(SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES).toBe(4096);
  });

  it("rejects oversized security audit details", () => {
    const oversized = "x".repeat(SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES);
    expect(() =>
      SecurityAuditEvent.create({
        id: "audit-2" as never,
        eventType: "user.created" as never,
        occurredAt: NOW,
        details: { payload: oversized },
      }),
    ).toThrow(DomainInvariantError);
  });
});
