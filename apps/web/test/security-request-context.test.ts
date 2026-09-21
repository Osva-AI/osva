import { describe, expect, it } from "vitest";

import {
  createRequestId,
  getSecurityRequestContext,
  runWithSecurityRequestContext,
} from "../src/security-request-context.js";

describe("security request context", () => {
  it("generates server-side request IDs and exposes context to handlers", async () => {
    const requestId = createRequestId();
    expect(requestId.length).toBeGreaterThan(10);

    await runWithSecurityRequestContext({ requestId }, async () => {
      expect(getSecurityRequestContext()?.requestId).toBe(requestId);
    });
  });
});
