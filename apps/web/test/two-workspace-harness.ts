import type { WorkspaceId } from "@osva/contracts";
import {
  OSVA_REQUEST_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
} from "@osva/contracts";
import { expect } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authorizationHeader,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

export const WS_A = "ws-matrix-a" as WorkspaceId;
export const WS_B = "ws-matrix-b" as WorkspaceId;

export interface TwoWorkspaceHarness {
  readonly origin: string;
  readonly authA: Record<string, string>;
  readonly authB: Record<string, string>;
  readonly ctx: Awaited<ReturnType<typeof createTestWebApplication>>;
}

export async function createTwoWorkspaceHarness(
  servers: import("node:http").Server[],
): Promise<TwoWorkspaceHarness> {
  const ctx = await createTestWebApplication({ workspaceId: WS_A });
  const { Workspace } = await import("@osva/domain");
  await ctx.workspaces.save(
    Workspace.create({
      id: WS_B,
      name: "Workspace B",
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
    }),
  );
  const keyB = await seedTestApiKey({
    apiKeys: ctx.apiKeys,
    workspaceId: WS_B,
    apiKeyId: "ak-matrix-b" as import("@osva/contracts").ApiKeyId,
  });

  servers.push(ctx.server);
  const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
  const origin = `http://127.0.0.1:${String(port)}`;

  return {
    origin,
    authA: authorizationHeader(ctx.testApiKey.plaintextToken),
    authB: authorizationHeader(keyB.plaintextToken),
    ctx,
  };
}

export async function fetchV1(
  url: string,
  options?: {
    readonly method?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown; requestId: string | null }> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      ...(options?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options?.headers,
    },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const requestId = response.headers.get(OSVA_REQUEST_ID_HEADER);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body, requestId };
}

export function expectV1Error(
  result: { status: number; body: unknown; requestId: string | null },
  status: number,
  code: string,
): void {
  expect(result.status).toBe(status);
  expect(result.body).toMatchObject({
    status: "error",
    code,
  });
  expect(result.requestId).toBeTruthy();
  if (typeof result.body === "object" && result.body !== null) {
    expect(result.body).toHaveProperty("requestId");
  }
}

export function expectNotFound(result: {
  status: number;
  body: unknown;
  requestId: string | null;
}): void {
  expectV1Error(result, 404, PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND);
}

export function expectForbidden(result: {
  status: number;
  body: unknown;
  requestId: string | null;
}): void {
  expectV1Error(result, 403, PUBLIC_API_ERROR_CODES.PERMISSION_DENIED);
}

export function expectUnauthorized(result: {
  status: number;
  body: unknown;
  requestId: string | null;
}): void {
  expectV1Error(result, 401, PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED);
}

export async function closeServers(
  servers: import("node:http").Server[],
): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => closeHttpServer(server)));
}
