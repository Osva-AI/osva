import { describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import {
  getMcpPrincipal,
  runWithMcpPrincipal,
} from "../src/principal-context.js";

const WS_A = "ws-a" as WorkspaceId;
const WS_B = "ws-b" as WorkspaceId;

describe("MCP principal async context", () => {
  it("throws when principal is not bound", () => {
    expect(() => getMcpPrincipal()).toThrow(/not available/);
  });

  it("isolates principals under concurrent overlapping async work", async () => {
    const observed: WorkspaceId[] = [];

    await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const workspaceId = index % 2 === 0 ? WS_A : WS_B;
        return runWithMcpPrincipal({ workspaceId }, async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, Math.floor(Math.random() * 15));
          });
          observed.push(getMcpPrincipal().workspaceId);
        });
      }),
    );

    for (const workspaceId of observed) {
      expect([WS_A, WS_B]).toContain(workspaceId);
    }
    expect(observed.some((id) => id === WS_A)).toBe(true);
    expect(observed.some((id) => id === WS_B)).toBe(true);
  });

  it("does not leak principal after the scoped run completes", async () => {
    await runWithMcpPrincipal({ workspaceId: WS_A }, async () => {
      expect(getMcpPrincipal().workspaceId).toBe(WS_A);
    });
    expect(() => getMcpPrincipal()).toThrow();
  });
});
