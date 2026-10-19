import {
  HUMAN_WORKSPACE_ROLES,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "@osva-ai/contracts";
import { User, WorkspaceMembership } from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import { lookupV1RouteAccess } from "../src/v1-route-human-access-inventory.js";
import { authorizeHumanControlPlaneRequest } from "../src/v1-control-plane-access.js";
import { structuralRouteKeyFromPathname } from "../src/v1-route-structural-key.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { authorizationHeader, createTestWebApplication } from "./test-web.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const WS = "ws-human-authz" as WorkspaceId;
const USER = "user-human-authz" as UserId;

describe("human workspace authorization", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("denies human sessions on API-key-only auth context route metadata", () => {
    const access = lookupV1RouteAccess("GET", "/v1/auth/context");
    expect(access?.accessClass).toBe("api_key_only");
  });

  it("allows human sessions to resolve model provider connection routes", () => {
    const access = lookupV1RouteAccess(
      "POST",
      "/v1/model-provider-connections",
    );
    expect(access?.accessClass).toBe("control_plane_workspace");
    expect(access?.requiredHumanPermission).toBe("WRITE");
  });

  it("maps model provider structural keys without treating segments as dynamic ids", () => {
    expect(
      structuralRouteKeyFromPathname(
        "POST",
        "/v1/model-provider-connections/ws-conn/versions",
      ),
    ).toBe("POST /v1/model-provider-connections/*/versions");
    expect(
      structuralRouteKeyFromPathname(
        "POST",
        "/v1/model-provider-connections/ws-conn/versions/ver-1/test",
      ),
    ).toBe("POST /v1/model-provider-connections/*/versions/*/test");

    const appendVersion = lookupV1RouteAccess(
      "POST",
      "/v1/model-provider-connections/conn-1/versions",
    );
    expect(appendVersion?.requiredHumanPermission).toBe("WRITE");
    expect(appendVersion?.resourceFamily).toBe("model_provider_connection");

    const connectivityTest = lookupV1RouteAccess(
      "POST",
      "/v1/model-provider-connections/conn-1/versions/ver-1/test",
    );
    expect(connectivityTest?.requiredHumanPermission).toBe("EXECUTE");
  });

  it("denies VIEWER human principals for model provider connection writes", async () => {
    const user = User.create({
      id: USER,
      email: "viewer-model@example.com",
      displayName: "Viewer",
      status: USER_STATUSES.ACTIVE,
      createdAt: NOW,
    });
    const membership = WorkspaceMembership.create({
      id: "wm-viewer-model" as WorkspaceMembershipId,
      workspaceId: WS,
      userId: USER,
      role: HUMAN_WORKSPACE_ROLES.VIEWER,
      createdAt: NOW,
    });
    const services = {
      users: {
        async save() {},
        async findById(id: UserId) {
          return id === USER ? user : null;
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
        async findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId) {
          return workspaceId === WS && userId === USER ? membership : null;
        },
        async listByWorkspaceId() {
          return [];
        },
        async listByUserId(userId: UserId) {
          return userId === USER ? [membership] : [];
        },
        async countByWorkspaceAndRole() {
          return 0;
        },
      },
    } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;

    await expect(
      authorizeHumanControlPlaneRequest(
        {
          headers: { "x-osva-workspace-id": WS },
        } as unknown as import("node:http").IncomingMessage,
        "POST",
        "/v1/model-provider-connections",
        services,
        {
          authenticationMethod: "HUMAN_SESSION",
          userId: USER,
          sessionId: "sess-viewer-model",
          workspaceId: WS,
        },
      ),
    ).rejects.toMatchObject({ name: "PermissionDeniedError" });
  });

  it("allows OPERATOR human principals for knowledge retrieve (EXECUTE)", async () => {
    const user = User.create({
      id: "user-operator" as UserId,
      email: "operator@example.com",
      displayName: "Operator",
      status: USER_STATUSES.ACTIVE,
      createdAt: NOW,
    });
    const membership = WorkspaceMembership.create({
      id: "wm-operator" as WorkspaceMembershipId,
      workspaceId: WS,
      userId: user.id,
      role: HUMAN_WORKSPACE_ROLES.OPERATOR,
      createdAt: NOW,
    });
    const services = {
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
        async findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId) {
          return workspaceId === WS && userId === user.id ? membership : null;
        },
        async listByWorkspaceId() {
          return [];
        },
        async listByUserId(userId: UserId) {
          return userId === user.id ? [membership] : [];
        },
        async countByWorkspaceAndRole() {
          return 0;
        },
      },
    } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;

    await expect(
      authorizeHumanControlPlaneRequest(
        {
          headers: { "x-osva-workspace-id": WS },
        } as unknown as import("node:http").IncomingMessage,
        "POST",
        "/v1/knowledge/retrieve",
        services,
        {
          authenticationMethod: "HUMAN_SESSION",
          userId: user.id,
          sessionId: "sess-operator",
          workspaceId: WS,
        },
      ),
    ).resolves.toMatchObject({
      humanRole: HUMAN_WORKSPACE_ROLES.OPERATOR,
    });
  });

  it("denies VIEWER human principals for agent creation at the gate", async () => {
    const user = User.create({
      id: USER,
      email: "viewer@example.com",
      displayName: "Viewer",
      status: USER_STATUSES.ACTIVE,
      createdAt: NOW,
    });
    const membership = WorkspaceMembership.create({
      id: "wm-viewer" as WorkspaceMembershipId,
      workspaceId: WS,
      userId: USER,
      role: HUMAN_WORKSPACE_ROLES.VIEWER,
      createdAt: NOW,
    });
    const services = {
      users: {
        async save() {},
        async findById(id: UserId) {
          return id === USER ? user : null;
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
        async findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId) {
          return workspaceId === WS && userId === USER ? membership : null;
        },
        async listByWorkspaceId() {
          return [];
        },
        async listByUserId(userId: UserId) {
          return userId === USER ? [membership] : [];
        },
        async countByWorkspaceAndRole() {
          return 0;
        },
      },
    } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;

    await expect(
      authorizeHumanControlPlaneRequest(
        {
          headers: { "x-osva-workspace-id": WS },
        } as unknown as import("node:http").IncomingMessage,
        "POST",
        "/v1/agents",
        services,
        {
          authenticationMethod: "HUMAN_SESSION",
          userId: USER,
          sessionId: "sess-1",
          workspaceId: WS,
        },
      ),
    ).rejects.toMatchObject({ name: "PermissionDeniedError" });
  });

  it("keeps API-key authentication required for missing credentials on /v1/agents", async () => {
    const ctx = await createTestWebApplication({ workspaceId: WS });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/agents`);
    const body = (await response.json()) as { code?: string };
    expect(response.status).toBe(401);
    expect(body.code).toBe(PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED);
  });

  it("preserves API-key list access for machine principals", async () => {
    const ctx = await createTestWebApplication({ workspaceId: WS });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/agents`, {
      headers: authorizationHeader(ctx.testApiKey.plaintextToken),
    });
    expect(response.status).toBe(200);
  });
});
