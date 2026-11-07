import { randomUUID } from "node:crypto";

import type {
  ModelProfileVersionId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";
import type { Database } from "@osva/db";
import {
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
} from "@osva/db";
import { WorkspaceMembership } from "@osva/domain";

import {
  consoleJson,
  CookieJar,
  HUMAN_PASSWORD,
  OWNER_EMAIL,
  type M12_3Stack,
} from "./m12-3-harness.js";

export const M20_6_VIEWER_EMAIL = "viewer.m20-6@test.local";

export async function consoleJsonWithHeaders(
  stack: M12_3Stack,
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; text: string; body: unknown }> {
  const response = await fetch(`${stack.consoleOrigin}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...headers,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    body = text;
  }
  return { status: response.status, text, body };
}

export async function ownerConsoleHeaders(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
): Promise<Record<string, string>> {
  const jar = new CookieJar();
  const login = await fetch(`${stack.consoleOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.consoleOrigin,
    },
    body: JSON.stringify({ email: OWNER_EMAIL, password: HUMAN_PASSWORD }),
  });
  jar.absorb(login);
  if (login.status !== 200) {
    throw new Error(`Owner console login failed: ${login.status}`);
  }
  return {
    cookie: jar.header() ?? "",
    origin: stack.consoleOrigin,
    "sec-fetch-site": "same-origin",
    "x-osva-workspace-id": workspaceId,
  };
}

export async function viewerConsoleHeaders(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
): Promise<Record<string, string>> {
  const jar = new CookieJar();
  const login = await fetch(`${stack.consoleOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.consoleOrigin,
    },
    body: JSON.stringify({
      email: M20_6_VIEWER_EMAIL,
      password: HUMAN_PASSWORD,
    }),
  });
  jar.absorb(login);
  if (login.status !== 200) {
    throw new Error(`Viewer console login failed: ${login.status}`);
  }
  return {
    cookie: jar.header() ?? "",
    origin: stack.consoleOrigin,
    "sec-fetch-site": "same-origin",
    "x-osva-workspace-id": workspaceId,
  };
}

export async function provisionViewerInWorkspaceA(
  stack: M12_3Stack,
): Promise<void> {
  const ownerLogin = await fetch(`${stack.webOrigin}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: stack.webOrigin,
    },
    body: JSON.stringify({ email: OWNER_EMAIL, password: HUMAN_PASSWORD }),
  });
  const ownerCookie = ownerLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (ownerLogin.status !== 200 || ownerCookie.length === 0) {
    throw new Error(`Owner web login failed: ${ownerLogin.status}`);
  }

  const provision = await fetch(
    `${stack.webOrigin}/v1/auth/workspaces/${stack.workspaceA}/members/users`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: stack.webOrigin,
        "x-osva-workspace-id": stack.workspaceA,
      },
      body: JSON.stringify({
        email: M20_6_VIEWER_EMAIL,
        displayName: "M20.6 Viewer",
        role: HUMAN_WORKSPACE_ROLES.VIEWER,
      }),
    },
  );
  if (provision.status !== 201) {
    throw new Error(`Viewer provision failed: ${provision.status}`);
  }
  const { setupToken } = (await provision.json()) as { setupToken: string };
  const setup = await fetch(
    `${stack.consoleOrigin}/api/v1/auth/setup/complete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: stack.consoleOrigin,
      },
      body: JSON.stringify({ token: setupToken, password: HUMAN_PASSWORD }),
    },
  );
  if (setup.status !== 200) {
    throw new Error(`Viewer setup failed: ${setup.status}`);
  }
}

export interface M20_6ModelProfileBundle {
  readonly generationModelProfileVersionId: ModelProfileVersionId;
  readonly executionModelProfileVersionId: ModelProfileVersionId;
  readonly alternateModelProfileVersionId: ModelProfileVersionId;
}

export async function provisionM20_6OpenAiModelProfiles(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
  headersProvider?: (workspace: WorkspaceId) => Promise<Record<string, string>>,
): Promise<M20_6ModelProfileBundle> {
  const headers = headersProvider
    ? await headersProvider(workspaceId)
    : stack.consoleHeaders(workspaceId);

  const request = async (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) => consoleJsonWithHeaders(stack, path, headers, init);

  const connection = await request("/api/v1/model-provider-connections", {
    method: "POST",
    body: {
      key: `m20-6-openai-${workspaceId}`,
      name: "M20.6 OpenAI",
      provider: "OPENAI",
    },
  });
  if (connection.status !== 201) {
    throw new Error(`Connection create failed: ${connection.status}`);
  }
  const connectionId = (connection.body as { id: string }).id;

  const version = await request(
    `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
    {
      method: "POST",
      body: {
        endpoint: {
          baseUrl: stack.fakeOpenAI.origin,
          allowPrivateNetworks: true,
        },
        credentialRef: { key: "OPENAI_API_KEY" },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(`Connection version failed: ${version.status}`);
  }
  const connectionVersionId = (version.body as { id: string }).id;

  const profile = await request("/api/v1/model-profiles", {
    method: "POST",
    body: { key: "builder", name: "Builder models" },
  });
  if (profile.status !== 201) {
    throw new Error(`Model profile create failed: ${profile.status}`);
  }
  const modelProfileId = (profile.body as { id: string }).id;

  async function createMpv(model: string): Promise<ModelProfileVersionId> {
    const mpv = await request(
      `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model,
          modelProviderConnectionVersionId: connectionVersionId,
        },
      },
    );
    if (mpv.status !== 201) {
      throw new Error(`Model profile version failed: ${mpv.status}`);
    }
    return (mpv.body as { id: string }).id as ModelProfileVersionId;
  }

  const generationModelProfileVersionId = await createMpv("gpt-m20-6-gen");
  const executionModelProfileVersionId = await createMpv("gpt-m20-6-exec");
  const alternateModelProfileVersionId = await createMpv("gpt-m20-6-alt");

  return {
    generationModelProfileVersionId,
    executionModelProfileVersionId,
    alternateModelProfileVersionId,
  };
}

export async function provisionM20_6OpenAiModelProfilesAsOwner(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
): Promise<M20_6ModelProfileBundle> {
  return provisionM20_6OpenAiModelProfiles(stack, workspaceId, (ws) =>
    ownerConsoleHeaders(stack, ws),
  );
}

/** M12.3 bootstraps the owner on workspace A only; grant ADMIN on B for isolation fixtures. */
export async function grantOwnerAdminOnWorkspaceB(
  database: Database,
  stack: M12_3Stack,
): Promise<void> {
  const users = new PostgresUserRepository(database);
  const owner = await users.findByEmail(OWNER_EMAIL);
  if (owner === null) {
    throw new Error("Owner user not found for workspace B grant.");
  }
  const memberships = new PostgresWorkspaceMembershipRepository(database);
  const existing = await memberships.findByWorkspaceAndUser(
    stack.workspaceB,
    owner.id,
  );
  if (existing !== null) {
    return;
  }
  await memberships.save(
    WorkspaceMembership.create({
      id: randomUUID() as WorkspaceMembershipId,
      workspaceId: stack.workspaceB,
      userId: owner.id,
      role: HUMAN_WORKSPACE_ROLES.ADMIN,
      createdAt: new Date(),
    }),
  );
}

export async function countWorkflowRuns(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
): Promise<number> {
  const res = await consoleJson(stack, workspaceId, "/api/v1/workflow-runs");
  if (res.status !== 200) {
    return -1;
  }
  const items = (res.body as { items?: unknown[] }).items;
  return Array.isArray(items) ? items.length : 0;
}
