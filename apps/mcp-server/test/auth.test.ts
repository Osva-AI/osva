import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { createBearerTokenMcpAuthenticator } from "../src/auth.js";

function requestWithAuth(value?: string): IncomingMessage {
  return {
    headers: value === undefined ? {} : { authorization: value },
  } as IncomingMessage;
}

describe("MCP bearer authentication", () => {
  const tokens = new Map<string, WorkspaceId>([
    ["token-a", "ws-a" as WorkspaceId],
    ["token-b", "ws-b" as WorkspaceId],
  ]);
  const authenticator = createBearerTokenMcpAuthenticator({ tokens });

  it("rejects missing auth", () => {
    expect(authenticator.authenticate(requestWithAuth())).toBeUndefined();
  });

  it("rejects invalid bearer auth", () => {
    expect(
      authenticator.authenticate(requestWithAuth("Bearer wrong")),
    ).toBeUndefined();
  });

  it("accepts valid bearer auth and derives workspace", () => {
    expect(
      authenticator.authenticate(requestWithAuth("Bearer token-a")),
    ).toEqual({ workspaceId: "ws-a" });
  });
});
