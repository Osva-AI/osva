import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetSecurityEventSink,
  setSecurityEventSink,
  SECURITY_EVENT_NAMES,
} from "@osva/observability";

import { createWebSecurityServices } from "../src/web-security-services.js";
import { AuthenticateApiKey } from "@osva/domain";
import { MemoryApiKeyRepository } from "@osva/adapters-memory";

describe("security observability", () => {
  afterEach(() => {
    resetSecurityEventSink();
    vi.restoreAllMocks();
  });

  it("does not log submitted bearer tokens on authentication failure", async () => {
    const events: string[] = [];
    setSecurityEventSink((fields) => {
      events.push(JSON.stringify(fields));
    });

    const secretToken = "osva_ak_leak_probe.super_secret_value";
    const services = createWebSecurityServices(
      new AuthenticateApiKey({
        apiKeys: new MemoryApiKeyRepository(),
        clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      }),
    );

    const principal = await services.authenticateBearerToken(secretToken);
    expect(principal).toBeNull();
    expect(events.join("\n")).not.toContain(secretToken);
    expect(events[0]).toContain(
      SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_FAILED,
    );
  });

  it("records bounded authentication failure reason codes", async () => {
    const captured: Array<Record<string, unknown>> = [];
    setSecurityEventSink((fields) => {
      captured.push({ ...fields });
    });

    const apiKeys = new MemoryApiKeyRepository();
    const authenticator = new AuthenticateApiKey({
      apiKeys,
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    });
    const services = createWebSecurityServices(authenticator);

    await services.authenticateBearerToken("not-a-valid-token");

    expect(captured[0]).toMatchObject({
      event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_FAILED,
      outcome: "DENIED",
      reasonCode: "malformed_token",
    });
  });
});
