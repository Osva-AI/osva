import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
  HUMAN_WORKSPACE_ROLES,
  OSVA_WORKSPACE_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "@osva-ai/contracts";
import { User, WorkspaceMembership } from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  WS_A,
  closeServers,
  createTwoWorkspaceHarness,
  fetchV1,
} from "./two-workspace-harness.js";

const TRUSTED_CONSOLE_ORIGIN = "http://127.0.0.1:4174";
const ADMIN_USER = "user-human-api-admin" as UserId;
const VIEWER_USER = "user-human-api-viewer" as UserId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

function humanAuthServices(
  workspaceId: WorkspaceId,
  role: (typeof HUMAN_WORKSPACE_ROLES)[keyof typeof HUMAN_WORKSPACE_ROLES],
  userId: UserId,
) {
  const user = User.create({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Human operator",
    status: USER_STATUSES.ACTIVE,
    createdAt: NOW,
  });
  const membership = WorkspaceMembership.create({
    id: `wm-${userId}` as WorkspaceMembershipId,
    workspaceId,
    userId,
    role,
    createdAt: NOW,
  });
  return {
    trustedOrigins: [TRUSTED_CONSOLE_ORIGIN],
    humanAuthentication: {
      async signOut() {},
      async getSession(token: string) {
        if (token === "sess-admin" && userId === ADMIN_USER) {
          return { userId: ADMIN_USER, sessionId: "sess-admin" };
        }
        if (token === "sess-viewer" && userId === VIEWER_USER) {
          return { userId: VIEWER_USER, sessionId: "sess-viewer" };
        }
        return null;
      },
    },
    users: {
      async save() {},
      async findById(id: UserId) {
        return id === user.id ? user : null;
      },
      async findByEmail() {
        return user;
      },
    },
    workspaceMemberships: {
      async save() {},
      async findById() {
        return null;
      },
      async findByWorkspaceAndUser(wid: WorkspaceId, uid: UserId) {
        return wid === workspaceId && uid === userId ? membership : null;
      },
      async listByWorkspaceId() {
        return [];
      },
      async listByUserId(uid: UserId) {
        return uid === userId ? [membership] : [];
      },
      async countByWorkspaceAndRole() {
        return 0;
      },
    },
  } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;
}

describe("Human session API key HTTP integration", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("allows ADMIN human session list/create/revoke with CSRF trusted origin", async () => {
    const harness = await createTwoWorkspaceHarness(servers, {
      humanAuth: humanAuthServices(
        WS_A,
        HUMAN_WORKSPACE_ROLES.ADMIN,
        ADMIN_USER,
      ),
      authenticateHumanSession: async () => ({
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: ADMIN_USER,
        sessionId: "sess-admin",
        workspaceId: WS_A,
      }),
    });

    const headers = {
      cookie: "osva.session_token=sess-admin",
      [OSVA_WORKSPACE_ID_HEADER]: WS_A,
      origin: TRUSTED_CONSOLE_ORIGIN,
    };

    const list = await fetchV1(`${harness.origin}/v1/api-keys`, { headers });
    expect(list.status).toBe(200);

    const created = await fetchV1(`${harness.origin}/v1/api-keys`, {
      method: "POST",
      headers,
      body: { name: "human-created", role: COMMUNITY_EDITION_ROLES.OPERATOR },
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      token: string;
      apiKey: { id: string };
    };
    expect(body.token).toMatch(/^osva_ak_/);

    const listAfter = await fetchV1(`${harness.origin}/v1/api-keys`, {
      headers,
    });
    expect(JSON.stringify(listAfter.body)).not.toContain(body.token);

    const withoutCsrf = await fetchV1(`${harness.origin}/v1/api-keys`, {
      method: "POST",
      headers: {
        cookie: headers.cookie,
        [OSVA_WORKSPACE_ID_HEADER]: WS_A,
        origin: "http://evil.example",
      },
      body: { name: "csrf-blocked", role: COMMUNITY_EDITION_ROLES.OPERATOR },
    });
    expect(withoutCsrf.status).toBe(403);
    expect(withoutCsrf.body).toMatchObject({
      code: PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
    });

    const revoked = await fetchV1(
      `${harness.origin}/v1/api-keys/${body.apiKey.id}/revoke`,
      { method: "POST", headers },
    );
    expect(revoked.status).toBe(200);
  });

  it("denies VIEWER human session for API key administration", async () => {
    const harness = await createTwoWorkspaceHarness(servers, {
      humanAuth: humanAuthServices(
        WS_A,
        HUMAN_WORKSPACE_ROLES.VIEWER,
        VIEWER_USER,
      ),
      authenticateHumanSession: async () => ({
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: VIEWER_USER,
        sessionId: "sess-viewer",
        workspaceId: WS_A,
      }),
    });

    const headers = {
      cookie: "osva.session_token=sess-viewer",
      [OSVA_WORKSPACE_ID_HEADER]: WS_A,
      origin: TRUSTED_CONSOLE_ORIGIN,
    };

    expect(
      (await fetchV1(`${harness.origin}/v1/api-keys`, { headers })).status,
    ).toBe(403);
    expect(
      (
        await fetchV1(`${harness.origin}/v1/api-keys`, {
          method: "POST",
          headers,
          body: { name: "x", role: COMMUNITY_EDITION_ROLES.OPERATOR },
        })
      ).status,
    ).toBe(403);
  });
});
