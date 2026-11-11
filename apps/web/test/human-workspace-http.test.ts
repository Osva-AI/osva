import {
  AUTHENTICATION_METHODS,
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
  OSVA_WORKSPACE_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type OrganizationId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "@osva-ai/contracts";
import {
  IdentityApplication,
  OrganizationMembership,
  User,
  Workspace,
  WorkspaceMembership,
} from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeServers,
  createTwoWorkspaceHarness,
  fetchV1,
  WS_A,
} from "./two-workspace-harness.js";

const TRUSTED = "http://127.0.0.1:4174";
const OWNER = "user-ws-owner" as UserId;
const VIEWER = "user-ws-viewer" as UserId;
const ORG = "org-ws-test" as OrganizationId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

function buildHumanAuth(workspaceId: WorkspaceId) {
  const users = new Map<UserId, User>();
  const memberships: WorkspaceMembership[] = [];
  const workspaces: Workspace[] = [];
  const orgMemberships: OrganizationMembership[] = [];

  async function seed() {
    for (const [id, email] of [
      [OWNER, "owner@example.com"],
      [VIEWER, "viewer@example.com"],
    ] as const) {
      users.set(
        id,
        User.create({
          id,
          email,
          displayName: id,
          status: USER_STATUSES.ACTIVE,
          createdAt: NOW,
        }),
      );
    }
    workspaces.push(
      Workspace.create({
        id: workspaceId,
        name: "Workspace A",
        createdAt: NOW,
        organizationId: ORG,
      }),
    );
    memberships.push(
      WorkspaceMembership.create({
        id: "wm-owner" as WorkspaceMembershipId,
        workspaceId,
        userId: OWNER,
        role: HUMAN_WORKSPACE_ROLES.OWNER,
        createdAt: NOW,
      }),
      WorkspaceMembership.create({
        id: "wm-viewer" as WorkspaceMembershipId,
        workspaceId,
        userId: VIEWER,
        role: HUMAN_WORKSPACE_ROLES.VIEWER,
        createdAt: NOW,
      }),
    );
    orgMemberships.push(
      OrganizationMembership.create({
        id: "om-owner" as import("@osva-ai/contracts").OrganizationMembershipId,
        organizationId: ORG,
        userId: OWNER,
        role: ORGANIZATION_MEMBERSHIP_ROLES.OWNER,
        createdAt: NOW,
      }),
    );
  }

  const lifecycle = {
    async registerUser() {},
    async createOrganizationWithOwner() {},
    async createWorkspaceWithOwner(input: {
      workspace: Workspace;
      membership: WorkspaceMembership;
    }) {
      workspaces.push(input.workspace);
      memberships.push(input.membership);
    },
    async assignWorkspaceOwnerMembership() {},
    async createWorkspaceMembership() {},
    async transferWorkspaceOwnership() {},
    async changeWorkspaceMembershipRole() {},
    async removeWorkspaceMembership() {},
  };

  const usersRepo = {
    async save(user: User) {
      users.set(user.id, user);
    },
    async findById(id: UserId) {
      return users.get(id) ?? null;
    },
    async findByEmail() {
      return null;
    },
  };
  const workspacesRepo = {
    async save(workspace: Workspace) {
      const index = workspaces.findIndex((w) => w.id === workspace.id);
      if (index >= 0) {
        workspaces[index] = workspace;
      } else {
        workspaces.push(workspace);
      }
    },
    async findById(id: WorkspaceId) {
      return workspaces.find((w) => w.id === id) ?? null;
    },
    async countAll() {
      return workspaces.length;
    },
    async listIds() {
      return workspaces.map((w) => w.id);
    },
    async listUnlinkedIds() {
      return [];
    },
  };
  const workspaceMembershipsRepo = {
    async save(m: WorkspaceMembership) {
      memberships.push(m);
    },
    async findById() {
      return null;
    },
    async findByWorkspaceAndUser(wid: WorkspaceId, uid: UserId) {
      return (
        memberships.find((m) => m.workspaceId === wid && m.userId === uid) ??
        null
      );
    },
    async listByUserId(uid: UserId) {
      return memberships.filter((m) => m.userId === uid);
    },
    async listByWorkspaceId() {
      return memberships;
    },
    async countByWorkspaceAndRole() {
      return 0;
    },
    async deleteById() {},
  };

  const identityApp = new IdentityApplication({
    users: usersRepo,
    workspaces: workspacesRepo,
    workspaceMemberships: workspaceMembershipsRepo,
    organizationMemberships: {
      async save(m: OrganizationMembership) {
        orgMemberships.push(m);
      },
      async findById() {
        return null;
      },
      async findByOrganizationAndUser(
        organizationId: OrganizationId,
        uid: UserId,
      ) {
        return (
          orgMemberships.find(
            (m) => m.organizationId === organizationId && m.userId === uid,
          ) ?? null
        );
      },
    },
    lifecycle,
    clock: { now: () => NOW },
    ids: { createId: () => `id-${String(workspaces.length + 1)}` },
  });

  return {
    seed,
    humanAuth: {
      trustedOrigins: [TRUSTED],
      humanAuthentication: {
        async signOut() {},
        async getSession(token: string) {
          if (token === "sess-owner") {
            return { userId: OWNER, sessionId: "sess-owner" };
          }
          if (token === "sess-viewer") {
            return { userId: VIEWER, sessionId: "sess-viewer" };
          }
          return null;
        },
      },
      identity: identityApp,
      users: usersRepo,
      workspaces: workspacesRepo,
      workspaceMemberships: workspaceMembershipsRepo,
      securityAuditEvents: { async append() {} },
      auth: {} as never,
      passwordTokens: {} as never,
      setupCompleteRedirectUrl: "http://127.0.0.1:8080/v1/auth/setup/complete",
    },
  };
}

describe("human workspace HTTP", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("creates workspace for organization owner and renames with ADMIN", async () => {
    const auth = buildHumanAuth(WS_A);
    await auth.seed();
    const harness = await createTwoWorkspaceHarness(servers, {
      workspaceId: WS_A,
      humanAuth: auth.humanAuth as never,
      authenticateHumanSession: async (request: {
        headers: { cookie?: string };
      }) => {
        const cookie = request.headers.cookie ?? "";
        if (cookie.includes("sess-viewer")) {
          return {
            authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
            userId: VIEWER,
            sessionId: "sess-viewer",
          };
        }
        return {
          authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
          userId: OWNER,
          sessionId: "sess-owner",
        };
      },
    });

    const create = await fetchV1(`${harness.origin}/v1/auth/workspaces`, {
      method: "POST",
      headers: {
        cookie: "osva.session_token=sess-owner",
        origin: TRUSTED,
      },
      body: { organizationId: ORG, name: "Workspace B" },
    });
    expect(create.status).toBe(201);
    const created = create.body as {
      workspace: { workspaceId: string; name: string };
    };

    const rename = await fetchV1(
      `${harness.origin}/v1/auth/workspaces/${encodeURIComponent(WS_A)}`,
      {
        method: "PATCH",
        headers: {
          cookie: "osva.session_token=sess-owner",
          [OSVA_WORKSPACE_ID_HEADER]: WS_A,
          origin: TRUSTED,
        },
        body: { name: "Renamed A" },
      },
    );
    expect(rename.status).toBe(200);
    expect(
      (rename.body as { workspace: { name: string } }).workspace.name,
    ).toBe("Renamed A");

    const viewerCreate = await fetchV1(`${harness.origin}/v1/auth/workspaces`, {
      method: "POST",
      headers: {
        cookie: "osva.session_token=sess-viewer",
        origin: TRUSTED,
      },
      body: { organizationId: ORG, name: "Blocked" },
    });
    expect(viewerCreate.status).toBe(403);

    const viewerRename = await fetchV1(
      `${harness.origin}/v1/auth/workspaces/${encodeURIComponent(created.workspace.workspaceId)}`,
      {
        method: "PATCH",
        headers: {
          cookie: "osva.session_token=sess-viewer",
          [OSVA_WORKSPACE_ID_HEADER]: created.workspace.workspaceId,
          origin: TRUSTED,
        },
        body: { name: "Evil" },
      },
    );
    expect(viewerRename.status).toBe(403);
    expect((viewerRename.body as { code?: string }).code).toBe(
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
    );
  });
});
