import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import {
  createRestAuthContextMcpAuthenticator,
  McpAuthenticationServiceUnavailableError,
} from "../src/auth.js";

function requestWithAuth(value?: string): IncomingMessage {
  return {
    headers: value === undefined ? {} : { authorization: value },
  } as IncomingMessage;
}

describe("MCP REST auth context authentication", () => {
  it("rejects missing auth", async () => {
    const authenticator = createRestAuthContextMcpAuthenticator({
      osvaApiBaseUrl: "http://127.0.0.1:1",
      fetch: async () => new Response("{}", { status: 401 }),
    });
    await expect(
      authenticator.authenticate(requestWithAuth()),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid bearer auth", async () => {
    const authenticator = createRestAuthContextMcpAuthenticator({
      osvaApiBaseUrl: "http://127.0.0.1:1",
      fetch: async () => new Response("{}", { status: 401 }),
    });
    await expect(
      authenticator.authenticate(requestWithAuth("Bearer wrong")),
    ).resolves.toBeUndefined();
  });

  it("accepts valid bearer auth from REST auth context without storing token on principal", async () => {
    const authenticator = createRestAuthContextMcpAuthenticator({
      osvaApiBaseUrl: "http://127.0.0.1:1",
      fetch: async (url, init) => {
        expect(String(url)).toBe("http://127.0.0.1:1/v1/auth/context");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer osva_ak_test",
        });
        return Response.json({
          subjectId: "ak-test",
          workspaceId: "ws-a",
          role: "ADMIN",
        });
      },
    });

    const identity = await authenticator.authenticate(
      requestWithAuth("Bearer osva_ak_test"),
    );
    expect(identity).toEqual({
      principal: {
        subjectId: "ak-test",
        workspaceId: "ws-a",
        role: "ADMIN",
      },
      bearerCredential: "osva_ak_test",
    });
    expect(JSON.stringify(identity?.principal)).not.toContain("osva_ak_test");
  });

  it("throws when auth context is unavailable", async () => {
    const authenticator = createRestAuthContextMcpAuthenticator({
      osvaApiBaseUrl: "http://127.0.0.1:1",
      fetch: async () => {
        throw new Error("network down");
      },
    });

    await expect(
      authenticator.authenticate(requestWithAuth("Bearer osva_ak_test")),
    ).rejects.toBeInstanceOf(McpAuthenticationServiceUnavailableError);
  });

  it("treats control-plane 5xx as service failure, not invalid credentials", async () => {
    const authenticator = createRestAuthContextMcpAuthenticator({
      osvaApiBaseUrl: "http://127.0.0.1:1",
      fetch: async () => new Response("upstream", { status: 503 }),
    });

    await expect(
      authenticator.authenticate(requestWithAuth("Bearer osva_ak_test")),
    ).rejects.toBeInstanceOf(McpAuthenticationServiceUnavailableError);
  });
});
