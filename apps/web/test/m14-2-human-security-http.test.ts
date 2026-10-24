import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHENTICATION_METHODS,
  PUBLIC_API_ERROR_CODES,
  type UserId,
} from "@osva-ai/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { authorizationHeader, createTestWebApplication } from "./test-web.js";
import {
  defaultHttpRateLimitContext,
  type HttpRateLimiter,
} from "../src/http-rate-limit.js";
import type { RateLimitConsumeResult } from "@osva/adapters-bullmq";

class RecordingRateLimiter implements HttpRateLimiter {
  readonly keys: string[] = [];

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitConsumeResult> {
    void limit;
    void windowSeconds;
    this.keys.push(key);
    return { outcome: "allowed", remaining: 1 };
  }
}

const TRUSTED_CONSOLE_ORIGIN = "http://127.0.0.1:4174";
const HUMAN_USER = "user-m142" as UserId;

describe("M14.2 human security HTTP integration", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("applies human rate-limit buckets, rejects malicious CSRF origins, and allows trusted same-site mutations", async () => {
    const limiter = new RecordingRateLimiter();
    const humanAuth = {
      trustedOrigins: [TRUSTED_CONSOLE_ORIGIN],
      humanAuthentication: {
        async signOut() {},
        async getSession() {
          return null;
        },
      },
    } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;

    const ctx = await createTestWebApplication({
      rateLimit: defaultHttpRateLimitContext(limiter, {
        unauthenticatedPerMinute: 100,
        authenticatedPerMinute: 100,
      }),
      humanAuth,
      authenticateHumanSession: async () => ({
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: HUMAN_USER,
        sessionId: "sess-m142",
      }),
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const apiOrigin = `http://127.0.0.1:${String(port)}`;

    const maliciousLogout = await fetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        cookie: "osva.session_token=test",
      },
    });
    expect(maliciousLogout.status).toBe(403);
    expect((await maliciousLogout.json()) as { code?: string }).toMatchObject({
      code: PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
    });

    const trustedLogout = await fetch(`${apiOrigin}/v1/auth/logout`, {
      method: "POST",
      headers: {
        origin: TRUSTED_CONSOLE_ORIGIN,
        cookie: "osva.session_token=test",
      },
    });
    expect(trustedLogout.status).toBe(204);

    await fetch(`${apiOrigin}/v1/me/workspaces`, {
      headers: {
        cookie: "osva.session_token=test",
      },
    });
    expect(
      limiter.keys.some((key) => key === `osva:rl:human:v1:${HUMAN_USER}`),
    ).toBe(true);

    const apiKeyResponse = await fetch(`${apiOrigin}/v1/auth/context`, {
      headers: authorizationHeader(ctx.testApiKey.plaintextToken),
    });
    expect(apiKeyResponse.status).toBe(200);
    expect(limiter.keys.some((key) => key.startsWith("osva:rl:key:v1:"))).toBe(
      true,
    );
  });
});
