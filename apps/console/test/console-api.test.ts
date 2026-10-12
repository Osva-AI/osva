import { describe, expect, it, vi } from "vitest";

import { consoleDownload, consoleFetch } from "../src/client/lib/console-api";

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

  it("returns the binary body without JSON-parsing success responses", async () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(payload, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": 'attachment; filename="bin.dat"',
          },
        });
      }),
    );

    const downloaded = await consoleDownload("/api/v1/artifacts/a1/content");
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toContain(
      "attachment",
    );
    expect(downloaded.body).not.toBeNull();
    const bytes = new Uint8Array(
      await new Response(downloaded.body).arrayBuffer(),
    );
    expect(bytes).toEqual(payload);
  });

  it("maps JSON download errors to ConsoleApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Resource not found.", code: "not_found" },
          {
            status: 404,
            headers: { "x-osva-request-id": "req-dl-404" },
          },
        ),
      ),
    );

    await expect(
      consoleDownload("/api/v1/artifacts/missing/content"),
    ).rejects.toMatchObject({
      status: 404,
      body: {
        error: "Resource not found.",
        code: "not_found",
        requestId: "req-dl-404",
      },
    });
  });
});
