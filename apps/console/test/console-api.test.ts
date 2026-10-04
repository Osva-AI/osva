import { describe, expect, it, vi } from "vitest";

import { consoleFetch } from "../src/client/lib/console-api";

describe("consoleFetch", () => {
  it("reads request ID from error body and response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Resource not found.", code: "not_found" },
          {
            status: 404,
            headers: { "x-osva-request-id": "req-from-header" },
          },
        ),
      ),
    );

    await expect(consoleFetch("/api/v1/runs/missing")).rejects.toMatchObject({
      status: 404,
      body: {
        error: "Resource not found.",
        code: "not_found",
        requestId: "req-from-header",
      },
    });
  });

  it("allows errors without request IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Unexpected console server error." },
          { status: 500 },
        ),
      ),
    );

    await expect(consoleFetch("/api/v1/runs")).rejects.toMatchObject({
      status: 500,
      body: {
        error: "Unexpected console server error.",
        requestId: undefined,
      },
    });
  });
});
