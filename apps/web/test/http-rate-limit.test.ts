import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHENTICATION_METHODS,
  PUBLIC_API_ERROR_CODES,
  type UserId,
} from "@osva-ai/contracts";
import { ValkeyUnavailableError } from "@osva/adapters-bullmq";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  defaultHttpRateLimitContext,
  type HttpRateLimiter,
} from "../src/http-rate-limit.js";
import type { RateLimitConsumeResult } from "@osva/adapters-bullmq";
import {
  authorizationHeader,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

class CountingRateLimiter implements HttpRateLimiter {
  readonly keys: string[] = [];
  failStore = false;

  constructor(private readonly counts = new Map<string, number>()) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitConsumeResult> {
    if (this.failStore) {
      throw new ValkeyUnavailableError();
    }
    this.keys.push(key);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next > limit) {
      return { outcome: "throttled", retryAfterSeconds: windowSeconds };
    }
    return { outcome: "allowed", remaining: limit - next };
  }
}

describe("HTTP rate limiting", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  async function listen(
    limiter: CountingRateLimiter,
    trustedProxies: readonly string[] = [],
  ) {
    const ctx = await createTestWebApplication({
      rateLimit: defaultHttpRateLimitContext(limiter, {
        unauthenticatedPerMinute: 2,
        authenticatedPerMinute: 2,
        trustedProxies,
      }),
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      token: ctx.testApiKey.plaintextToken,
    };
  }

  it("returns 429 RATE_LIMITED with Retry-After for unauthenticated /v1 traffic", async () => {
    const limiter = new CountingRateLimiter();
    const { origin } = await listen(limiter);
    const responses = [];
    for (let index = 0; index < 3; index += 1) {
      responses.push(await fetch(`${origin}/v1/auth/context`));
    }
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 429,
    ]);
    const limited = responses[2]!;
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.headers.get("x-osva-request-id")).toEqual(
      expect.any(String),
    );
    const body = (await limited.json()) as { status?: string; code?: string };
    expect(body).toMatchObject({
      status: "error",
      code: PUBLIC_API_ERROR_CODES.RATE_LIMITED,
    });
    expect(JSON.stringify(body)).not.toMatch(/osva_ak_|Bearer/i);
  });

  it("returns 429 for an authenticated key after its threshold and keeps health unthrottled", async () => {
    const limiter = new CountingRateLimiter();
    const { origin, token } = await listen(limiter);
    const headers = authorizationHeader(token);
    expect((await fetch(`${origin}/v1/auth/context`, { headers })).status).toBe(
      200,
    );
    expect((await fetch(`${origin}/v1/auth/context`, { headers })).status).toBe(
      200,
    );
    const limited = await fetch(`${origin}/v1/auth/context`, { headers });
    expect(limited.status).toBe(429);
    expect((await fetch(`${origin}/health`)).status).toBe(200);
    expect(limiter.keys.every((key) => !key.includes(token))).toBe(true);
  });

  it("does not let spoofed X-Forwarded-For bypass the unauthenticated bucket", async () => {
    const limiter = new CountingRateLimiter();
    const { origin } = await listen(limiter);
    await fetch(`${origin}/v1/auth/context`, {
      headers: { "x-forwarded-for": "8.8.8.8" },
    });
    await fetch(`${origin}/v1/auth/context`, {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    const limited = await fetch(`${origin}/v1/auth/context`, {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(limited.status).toBe(429);
  });

  it("uses forwarded client IPs only behind a trusted proxy CIDR", async () => {
    const limiter = new CountingRateLimiter();
    const { origin } = await listen(limiter, ["127.0.0.1/32", "::1/128"]);
    expect(
      (
        await fetch(`${origin}/v1/auth/context`, {
          headers: { "x-forwarded-for": "198.51.100.1" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/v1/auth/context`, {
          headers: { "x-forwarded-for": "198.51.100.1" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/v1/auth/context`, {
          headers: { "x-forwarded-for": "198.51.100.1" },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await fetch(`${origin}/v1/auth/context`, {
          headers: { "x-forwarded-for": "198.51.100.2" },
        })
      ).status,
    ).toBe(401);
  });

  it("returns SERVICE_UNAVAILABLE when the rate-limit store is down", async () => {
    const limiter = new CountingRateLimiter();
    limiter.failStore = true;
    const { origin } = await listen(limiter);
    const response = await fetch(`${origin}/v1/auth/context`);
    expect(response.status).toBe(503);
    expect((await response.json()) as { code?: string }).toMatchObject({
      code: PUBLIC_API_ERROR_CODES.SERVICE_UNAVAILABLE,
    });
    expect(response.headers.get("retry-after")).toBeNull();
  });

  it("resumes ordinary /v1 traffic after the rate-limit store recovers", async () => {
    const limiter = new CountingRateLimiter();
    limiter.failStore = true;
    const { origin } = await listen(limiter);
    expect((await fetch(`${origin}/v1/auth/context`)).status).toBe(503);
    limiter.failStore = false;
    expect((await fetch(`${origin}/v1/auth/context`)).status).toBe(401);
  });

  it("treats missing and malformed Bearer tokens as the unauthenticated IP bucket", async () => {
    const limiter = new CountingRateLimiter();
    const { origin } = await listen(limiter);
    expect((await fetch(`${origin}/v1/auth/context`)).status).toBe(401);
    expect(
      (
        await fetch(`${origin}/v1/auth/context`, {
          headers: { authorization: "Bearer not-a-key" },
        })
      ).status,
    ).toBe(401);
    const limited = await fetch(`${origin}/v1/auth/context`, {
      headers: { authorization: "Bearer osva_ak_missing.secret" },
    });
    expect(limited.status).toBe(429);
    expect(
      limiter.keys.every((key) => key.startsWith("osva:rl:unauth:v1:")),
    ).toBe(true);
  });

  it("uses stable human user buckets for authenticated session traffic", async () => {
    const limiter = new CountingRateLimiter();
    const userA = "user-rate-a" as UserId;
    const userB = "user-rate-b" as UserId;
    const ctx = await createTestWebApplication({
      rateLimit: defaultHttpRateLimitContext(limiter, {
        unauthenticatedPerMinute: 100,
        authenticatedPerMinute: 2,
      }),
      authenticateHumanSession: async (request) => {
        const cookie = request.headers.cookie ?? "";
        if (cookie.includes("session-user-a")) {
          return {
            authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
            userId: userA,
            sessionId: "sess-a-1",
          };
        }
        if (cookie.includes("session-user-b")) {
          return {
            authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
            userId: userB,
            sessionId: "sess-b-1",
          };
        }
        if (cookie.includes("session-user-a-alt")) {
          return {
            authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
            userId: userA,
            sessionId: "sess-a-2",
          };
        }
        return null;
      },
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const cookieA = { cookie: "osva.session_token=session-user-a" };
    const cookieB = { cookie: "osva.session_token=session-user-b" };
    const cookieAAlt = { cookie: "osva.session_token=session-user-a-alt" };

    expect(
      (await fetch(`${origin}/v1/me/workspaces`, { headers: cookieA })).status,
    ).toBe(404);
    expect(
      (await fetch(`${origin}/v1/me/workspaces`, { headers: cookieA })).status,
    ).toBe(404);
    expect(
      (await fetch(`${origin}/v1/me/workspaces`, { headers: cookieA })).status,
    ).toBe(429);
    expect(
      (await fetch(`${origin}/v1/me/workspaces`, { headers: cookieB })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${origin}/v1/me/workspaces`, {
          headers: cookieAAlt,
        })
      ).status,
    ).toBe(429);
    expect(
      limiter.keys.filter((key) => key === `osva:rl:human:v1:${userA}`).length,
    ).toBeGreaterThan(0);
    expect(
      limiter.keys.filter((key) => key === `osva:rl:human:v1:${userB}`).length,
    ).toBeGreaterThan(0);
    expect(limiter.keys.every((key) => !key.includes("session-user"))).toBe(
      true,
    );
  });

  it("does not assign human buckets from spoofed identity headers", async () => {
    const limiter = new CountingRateLimiter();
    const ctx = await createTestWebApplication({
      rateLimit: defaultHttpRateLimitContext(limiter, {
        unauthenticatedPerMinute: 2,
        authenticatedPerMinute: 100,
      }),
      authenticateHumanSession: async () => null,
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const headers = {
      "x-osva-user-id": "user-spoof",
      cookie: "osva.session_token=invalid",
    };
    await fetch(`${origin}/v1/auth/context`, { headers });
    await fetch(`${origin}/v1/auth/context`, { headers });
    const limited = await fetch(`${origin}/v1/auth/context`, { headers });
    expect(limited.status).toBe(429);
    expect(
      limiter.keys.every((key) => key.startsWith("osva:rl:unauth:v1:")),
    ).toBe(true);
    expect(limiter.keys.some((key) => key.includes("human"))).toBe(false);
  });

  it("isolates authenticated buckets by API key and workspace", async () => {
    const limiter = new CountingRateLimiter();
    const ctx = await createTestWebApplication({
      rateLimit: defaultHttpRateLimitContext(limiter, {
        unauthenticatedPerMinute: 100,
        authenticatedPerMinute: 2,
      }),
    });
    servers.push(ctx.server);
    const { Workspace } = await import("@osva/domain");
    const otherWorkspaceId =
      "ws-rate-b" as import("@osva-ai/contracts").WorkspaceId;
    await ctx.workspaces.save(
      Workspace.create({
        id: otherWorkspaceId,
        name: "Other",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
    const secondKey = await seedTestApiKey({
      apiKeys: ctx.apiKeys,
      workspaceId: ctx.workspaceId,
      apiKeyId: "ak-rate-second" as import("@osva-ai/contracts").ApiKeyId,
    });
    const otherWorkspaceKey = await seedTestApiKey({
      apiKeys: ctx.apiKeys,
      workspaceId: otherWorkspaceId,
      apiKeyId: "ak-rate-ws-b" as import("@osva-ai/contracts").ApiKeyId,
    });
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;

    const first = authorizationHeader(ctx.testApiKey.plaintextToken);
    const second = authorizationHeader(secondKey.plaintextToken);
    const other = authorizationHeader(otherWorkspaceKey.plaintextToken);

    expect(
      (await fetch(`${origin}/v1/auth/context`, { headers: first })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/v1/auth/context`, { headers: first })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/v1/auth/context`, { headers: first })).status,
    ).toBe(429);
    expect(
      (await fetch(`${origin}/v1/auth/context`, { headers: second })).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/v1/auth/context`, { headers: other })).status,
    ).toBe(200);
    expect(
      limiter.keys.some((key) =>
        key.includes(`${ctx.workspaceId}:${ctx.testApiKey.apiKeyId}`),
      ),
    ).toBe(true);
    expect(
      limiter.keys.some((key) =>
        key.includes(`${ctx.workspaceId}:${secondKey.apiKeyId}`),
      ),
    ).toBe(true);
    expect(
      limiter.keys.some((key) =>
        key.includes(`${otherWorkspaceId}:${otherWorkspaceKey.apiKeyId}`),
      ),
    ).toBe(true);
  });
});
