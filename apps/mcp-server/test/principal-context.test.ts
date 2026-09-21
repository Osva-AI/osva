import { describe, expect, it } from "vitest";
import type { ApiKeyId, WorkspaceId } from "@osva/contracts";

import type { AuthenticatedMcpIdentity } from "../src/auth.js";
import {
  getMcpBearerCredential,
  getMcpPrincipal,
  runWithMcpPrincipal,
} from "../src/principal-context.js";

const WS_A = "ws-a" as WorkspaceId;
const WS_B = "ws-b" as WorkspaceId;
const SECRET_A = "osva_ak_secret_a_do_not_log";
const SECRET_B = "osva_ak_secret_b_do_not_log";

const IDENTITY_A: AuthenticatedMcpIdentity = {
  principal: {
    subjectId: "ak-a" as ApiKeyId,
    workspaceId: WS_A,
    role: "ADMIN",
  },
  bearerCredential: SECRET_A,
};

const IDENTITY_B: AuthenticatedMcpIdentity = {
  principal: {
    subjectId: "ak-b" as ApiKeyId,
    workspaceId: WS_B,
    role: "EDITOR",
  },
  bearerCredential: SECRET_B,
};

describe("MCP principal async context", () => {
  it("throws when principal is not bound", () => {
    expect(() => getMcpPrincipal()).toThrow(/not available/);
  });

  it("keeps bearer credentials out of the principal object", async () => {
    await runWithMcpPrincipal(IDENTITY_A, async () => {
      const principal = getMcpPrincipal();
      expect(principal).toEqual(IDENTITY_A.principal);
      expect(JSON.stringify(principal)).not.toContain(SECRET_A);
      expect(getMcpBearerCredential()).toBe(SECRET_A);
    });
  });

  it("isolates principals and credentials under concurrent overlapping async work", async () => {
    const observed: WorkspaceId[] = [];
    const credentials: string[] = [];

    await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const identity = index % 2 === 0 ? IDENTITY_A : IDENTITY_B;
        return runWithMcpPrincipal(identity, async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, Math.floor(Math.random() * 15));
          });
          observed.push(getMcpPrincipal().workspaceId);
          credentials.push(getMcpBearerCredential());
        });
      }),
    );

    for (const workspaceId of observed) {
      expect([WS_A, WS_B]).toContain(workspaceId);
    }
    expect(
      credentials.every((value) => value === SECRET_A || value === SECRET_B),
    ).toBe(true);
    expect(observed.some((id) => id === WS_A)).toBe(true);
    expect(observed.some((id) => id === WS_B)).toBe(true);
  });

  it("does not leak principal after the scoped run completes", async () => {
    await runWithMcpPrincipal(IDENTITY_A, async () => {
      expect(getMcpPrincipal().workspaceId).toBe(WS_A);
    });
    expect(() => getMcpPrincipal()).toThrow();
    expect(() => getMcpBearerCredential()).toThrow();
  });
});
