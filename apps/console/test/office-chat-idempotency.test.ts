import { describe, expect, it } from "vitest";

import { createMessageIdempotencyKey } from "../src/client/lib/office-chat-idempotency";

describe("createMessageIdempotencyKey", () => {
  it("returns distinct keys for successive calls", () => {
    const first = createMessageIdempotencyKey();
    const second = createMessageIdempotencyKey();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(8);
  });
});
