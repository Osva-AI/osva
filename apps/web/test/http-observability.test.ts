import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_EDITION_ROLES,
  PUBLIC_API_ERROR_CODES,
} from "@osva-ai/contracts";
import {
  OSVA_METRIC,
  OSVA_SPAN,
  RecordingInstrumentation,
  resetSecurityEventInstrumentation,
  resetSecurityEventSink,
  SECURITY_EVENT_NAMES,
  setSecurityEventSink,
} from "@osva/observability";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { defaultHttpRateLimitContext } from "../src/http-rate-limit.js";
import { ValkeyUnavailableError } from "@osva/adapters-bullmq";
import type { RateLimitConsumeResult } from "@osva/adapters-bullmq";
import {
  authorizationHeader,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";
import { setTestAuthHeaders } from "./http-test-helpers.js";

class ScriptedRateLimiter {
  constructor(
    private readonly result: RateLimitConsumeResult | "unavailable",
  ) {}

  async consume(): Promise<RateLimitConsumeResult> {
    if (this.result === "unavailable") {
      throw new ValkeyUnavailableError();
    }
    return this.result;
  }
}

describe("HTTP operational observability", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    resetSecurityEventSink();
    resetSecurityEventInstrumentation();
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("correlates request IDs and omits secrets from 401 missing-bearer telemetry", async () => {
    const telemetry = new RecordingInstrumentation();
    const events: Array<Record<string, unknown>> = [];
    const logs: Array<Record<string, unknown>> = [];
    setSecurityEventSink((fields) => {
      events.push({ ...fields });
    });
    const { server } = await createTestWebApplication({
      instrumentation: telemetry,
      logEvent: (event, fields) => {
        logs.push({ event, ...fields });
      },
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;

    const response = await fetch(`${origin}/v1/runs`);
    const requestId = response.headers.get("x-osva-request-id");

    expect(response.status).toBe(401);
    expect(requestId).toBeTruthy();
    expect(events).toEqual([
      expect.objectContaining({
        event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING,
        requestId,
        outcome: "DENIED",
        reasonCode: "missing_bearer",
      }),
    ]);
    expect(telemetry.countersNamed(OSVA_METRIC.SECURITY_EVENTS)).toHaveLength(
      1,
    );
    expect(
      telemetry.spans.some((span) => span.name === OSVA_SPAN.HTTP_REQUEST),
    ).toBe(true);
    expect(
      JSON.stringify({ events, logs, metrics: telemetry.metrics }),
    ).not.toContain("Authorization");
    expect(JSON.stringify({ events, logs })).not.toContain("osva_ak_");
  });

  it("does not emit missing-bearer when an invalid API key is presented", async () => {
    const telemetry = new RecordingInstrumentation();
    const events: string[] = [];
    setSecurityEventSink((fields) => {
      events.push(fields.event);
    });
    const { server } = await createTestWebApplication({
      instrumentation: telemetry,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);

    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/runs`, {
      headers: { Authorization: "Bearer osva_ak_invalid.token" },
    });

    expect(response.status).toBe(401);
    expect(events).toEqual([SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_FAILED]);
    expect(events).not.toContain(
      SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING,
    );
    expect(JSON.stringify(events)).not.toContain("osva_ak_invalid.token");
  });

  it("records 429 and 503 rate-limit outcomes without changing response bodies", async () => {
    const telemetry = new RecordingInstrumentation();
    const events: string[] = [];
    setSecurityEventSink((fields) => {
      events.push(fields.event);
    });

    const limited = await createTestWebApplication({
      instrumentation: telemetry,
      rateLimit: defaultHttpRateLimitContext(
        new ScriptedRateLimiter({
          outcome: "throttled",
          retryAfterSeconds: 60,
        }),
        { unauthenticatedPerMinute: 1, authenticatedPerMinute: 1 },
      ),
    });
    servers.push(limited.server);
    const limitedPort = await listenHttpServer(limited.server, "127.0.0.1", 0);
    const limitedResponse = await fetch(
      `http://127.0.0.1:${String(limitedPort)}/v1/runs`,
    );
    expect(limitedResponse.status).toBe(429);
    expect(await limitedResponse.json()).toMatchObject({
      code: PUBLIC_API_ERROR_CODES.RATE_LIMITED,
    });

    const unavailable = await createTestWebApplication({
      instrumentation: telemetry,
      rateLimit: defaultHttpRateLimitContext(
        new ScriptedRateLimiter("unavailable"),
        {
          unauthenticatedPerMinute: 1,
          authenticatedPerMinute: 1,
        },
      ),
    });
    servers.push(unavailable.server);
    const unavailablePort = await listenHttpServer(
      unavailable.server,
      "127.0.0.1",
      0,
    );
    const unavailableResponse = await fetch(
      `http://127.0.0.1:${String(unavailablePort)}/v1/runs`,
    );
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toMatchObject({
      code: PUBLIC_API_ERROR_CODES.SERVICE_UNAVAILABLE,
    });

    expect(events).toEqual([
      SECURITY_EVENT_NAMES.RATE_LIMIT_THROTTLED,
      SECURITY_EVENT_NAMES.RATE_LIMIT_STORE_UNAVAILABLE,
    ]);
    expect(
      telemetry
        .countersNamed(OSVA_METRIC.SECURITY_EVENTS)
        .map((metric) => metric.attributes?.event),
    ).toEqual([
      SECURITY_EVENT_NAMES.RATE_LIMIT_THROTTLED,
      SECURITY_EVENT_NAMES.RATE_LIMIT_STORE_UNAVAILABLE,
    ]);
  });

  it("records authorization denials as 403 security events", async () => {
    const telemetry = new RecordingInstrumentation();
    const events: string[] = [];
    setSecurityEventSink((fields) => {
      events.push(fields.event);
    });
    const ctx = await createTestWebApplication({
      instrumentation: telemetry,
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    setTestAuthHeaders(ctx.testApiKey);
    const viewer = await seedTestApiKey({
      apiKeys: ctx.apiKeys,
      workspaceId: ctx.workspaceId,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      apiKeyId: "ak-viewer-obs" as never,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/runs`, {
      method: "POST",
      headers: {
        ...authorizationHeader(viewer.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId: "00000000-0000-4000-8000-000000000001",
        agentVersionId: "00000000-0000-4000-8000-000000000002",
        input: { prompt: "secret-prompt" },
      }),
    });

    expect(response.status).toBe(403);
    expect(events).toContain(SECURITY_EVENT_NAMES.AUTH_AUTHORIZATION_DENIED);
    expect(JSON.stringify(telemetry.metrics)).not.toContain("secret-prompt");
    expect(JSON.stringify(telemetry.spans)).not.toContain("secret-prompt");
  });
});
