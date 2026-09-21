import {
  COMMUNITY_EDITION_ROLES,
  PUBLIC_API_ERROR_CODES,
} from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { authorizationHeader, seedTestApiKey } from "./test-web.js";
import {
  WS_A,
  WS_B,
  closeServers,
  createTwoWorkspaceHarness,
  fetchV1,
} from "./two-workspace-harness.js";

describe("API key lifecycle HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("denies non-ADMIN list and create", async () => {
    const harness = await createTwoWorkspaceHarness(servers);
    const editor = await seedTestApiKey({
      apiKeys: harness.ctx.apiKeys,
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.EDITOR,
      apiKeyId: "ak-editor-keys" as import("@osva/contracts").ApiKeyId,
    });
    const viewer = await seedTestApiKey({
      apiKeys: harness.ctx.apiKeys,
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      apiKeyId: "ak-viewer-keys" as import("@osva/contracts").ApiKeyId,
    });
    const operator = await seedTestApiKey({
      apiKeys: harness.ctx.apiKeys,
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.OPERATOR,
      apiKeyId: "ak-operator-keys" as import("@osva/contracts").ApiKeyId,
    });

    for (const token of [
      editor.plaintextToken,
      viewer.plaintextToken,
      operator.plaintextToken,
    ]) {
      const headers = authorizationHeader(token);
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
    }

    expect(
      (
        await fetchV1(`${harness.origin}/v1/api-keys`, {
          headers: harness.authA,
        })
      ).status,
    ).toBe(200);
  });

  it("ADMIN creates key with one-time token and lists workspace-scoped metadata", async () => {
    const harness = await createTwoWorkspaceHarness(servers);
    await seedTestApiKey({
      apiKeys: harness.ctx.apiKeys,
      workspaceId: WS_B,
      apiKeyId: "ak-b-only" as import("@osva/contracts").ApiKeyId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    const created = await fetchV1(`${harness.origin}/v1/api-keys`, {
      method: "POST",
      headers: harness.authA,
      body: { name: "svc-bot", role: COMMUNITY_EDITION_ROLES.OPERATOR },
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      token: string;
      apiKey: { id: string; name: string; role: string };
    };
    expect(body.token).toMatch(/^osva_ak_/);
    expect(body.apiKey.name).toBe("svc-bot");

    const list = await fetchV1(`${harness.origin}/v1/api-keys`, {
      headers: harness.authA,
    });
    expect(list.status).toBe(200);
    const listed = (list.body as { apiKeys: { id: string }[] }).apiKeys;
    expect(listed.some((entry) => entry.id === body.apiKey.id)).toBe(true);
    expect(listed.every((entry) => entry.id !== "ak-b-only")).toBe(true);
    const serialized = JSON.stringify(list.body);
    expect(serialized).not.toContain(body.token);
    expect(serialized).not.toMatch(/secretDigest|verifier|digest/i);
  });

  it("revokes foreign keys with 404 and self-revoke without restart", async () => {
    const harness = await createTwoWorkspaceHarness(servers);
    const keyInB = await seedTestApiKey({
      apiKeys: harness.ctx.apiKeys,
      workspaceId: WS_B,
      apiKeyId: "ak-revoke-b" as import("@osva/contracts").ApiKeyId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    const created = await fetchV1(`${harness.origin}/v1/api-keys`, {
      method: "POST",
      headers: harness.authA,
      body: { name: "self-revoke", role: COMMUNITY_EDITION_ROLES.ADMIN },
    });
    const createdBody = created.body as {
      token: string;
      apiKey: { id: string };
    };
    const selfHeaders = authorizationHeader(createdBody.token);

    const foreign = await fetchV1(
      `${harness.origin}/v1/api-keys/${keyInB.apiKeyId}/revoke`,
      { method: "POST", headers: harness.authA },
    );
    expect(foreign.status).toBe(404);

    const revoked = await fetchV1(
      `${harness.origin}/v1/api-keys/${createdBody.apiKey.id}/revoke`,
      { method: "POST", headers: selfHeaders },
    );
    expect(revoked.status).toBe(200);

    const next = await fetchV1(`${harness.origin}/v1/agents`, {
      headers: selfHeaders,
    });
    expect(next.status).toBe(401);
    expect((next.body as { code?: string }).code).toBe(
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
    );
  });
});
