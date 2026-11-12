import { describe, expect, it } from "vitest";

/**
 * Documents send retry contract: key is allocated once per composer attempt
 * and cleared only after a successful POST (see OfficeChatPage.handleSendMessage).
 */
describe("office message idempotency send contract", () => {
  it("reuses the same key until send succeeds", () => {
    let pending: string | undefined;
    let counter = 0;
    function allocate(): string {
      if (pending === undefined) {
        counter += 1;
        pending = `idem-${String(counter)}`;
      }
      return pending;
    }
    function succeed(): void {
      pending = undefined;
    }

    expect(allocate()).toBe("idem-1");
    expect(allocate()).toBe("idem-1");
    succeed();
    expect(allocate()).toBe("idem-2");
  });
});
