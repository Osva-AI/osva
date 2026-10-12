import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleApiError } from "../src/client/lib/console-api";
import {
  ArtifactPreviewCancelledError,
  ArtifactPreviewLimitError,
  MAX_ARTIFACT_PREVIEW_BYTES,
  artifactContentPath,
  classifyArtifactPreview,
  describePreviewUnavailable,
  fetchArtifactPreviewText,
  parseJsonPreview,
  previewErrorMessage,
  readBoundedUtf8,
} from "../src/client/lib/artifact-preview";

describe("classifyArtifactPreview", () => {
  it("allows markdown, plain text, and JSON under the size cap", () => {
    expect(
      classifyArtifactPreview({
        mediaType: "text/markdown; charset=utf-8",
        sizeBytes: 12,
      }),
    ).toBe("text");
    expect(
      classifyArtifactPreview({ mediaType: "text/plain", sizeBytes: 1 }),
    ).toBe("text");
    expect(
      classifyArtifactPreview({
        mediaType: "application/json",
        sizeBytes: 8,
      }),
    ).toBe("json");
  });

  it("rejects HTML, SVG, and other unsafe or unknown types without fetching", () => {
    expect(
      classifyArtifactPreview({ mediaType: "text/html", sizeBytes: 10 }),
    ).toBe("unsupported");
    expect(
      classifyArtifactPreview({
        mediaType: "image/svg+xml",
        sizeBytes: 10,
      }),
    ).toBe("unsupported");
    expect(
      classifyArtifactPreview({
        mediaType: "application/pdf",
        sizeBytes: 10,
      }),
    ).toBe("unsupported");
    expect(
      classifyArtifactPreview({
        mediaType: "application/octet-stream",
        sizeBytes: 10,
      }),
    ).toBe("unsupported");
    expect(describePreviewUnavailable("unsupported")).toMatch(/not available/i);
  });

  it("blocks preview when metadata size exceeds 512 KiB", () => {
    expect(
      classifyArtifactPreview({
        mediaType: "text/markdown",
        sizeBytes: MAX_ARTIFACT_PREVIEW_BYTES + 1,
      }),
    ).toBe("too-large");
    expect(describePreviewUnavailable("too-large")).toMatch(/512 KiB/);
  });
});

describe("readBoundedUtf8", () => {
  it("decodes UTF-8 characters that span chunk boundaries", async () => {
    const euro = new TextEncoder().encode("€");
    expect(euro.byteLength).toBe(3);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(euro.subarray(0, 1));
        controller.enqueue(euro.subarray(1));
        controller.close();
      },
    });

    await expect(readBoundedUtf8(body, 16)).resolves.toBe("€");
  });

  it("cancels the reader when the streamed byte limit is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8).fill(0x61));
        controller.enqueue(new Uint8Array(8).fill(0x62));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBoundedUtf8(body, 10)).rejects.toBeInstanceOf(
      ArtifactPreviewLimitError,
    );
    expect(cancelled).toBe(true);
  });

  it("does not keep bytes after the cap", async () => {
    const chunks: Uint8Array[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const first = new Uint8Array(4).fill(0x61);
        const overflow = new Uint8Array(8).fill(0x62);
        chunks.push(first, overflow);
        controller.enqueue(first);
        controller.enqueue(overflow);
      },
    });

    await expect(readBoundedUtf8(body, 4)).rejects.toBeInstanceOf(
      ArtifactPreviewLimitError,
    );
  });

  it("surfaces cancellation when the abort signal fires", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start() {
        controller.abort();
      },
    });

    await expect(
      readBoundedUtf8(body, 32, controller.signal),
    ).rejects.toBeInstanceOf(ArtifactPreviewCancelledError);
  });
});

describe("fetchArtifactPreviewText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a bounded stream from the same-origin content route", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("# Report"));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchArtifactPreviewText("art-1")).resolves.toBe("# Report");
    expect(fetchMock).toHaveBeenCalledWith(
      artifactContentPath("art-1"),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("maps 403, 404, and 503 without leaking storage details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Resource not found.", code: "not_found" },
          { status: 404 },
        ),
      ),
    );
    const notFound = await fetchArtifactPreviewText("missing").catch(
      (error: unknown) => error,
    );
    expect(notFound).toBeInstanceOf(ConsoleApiError);
    expect(previewErrorMessage(notFound)).toBe("Artifact was not found.");
    expect(previewErrorMessage(notFound)).not.toContain(".osva/artifacts");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Permission denied.", code: "permission_denied" },
          { status: 403 },
        ),
      ),
    );
    const denied = await fetchArtifactPreviewText("art-1").catch(
      (error: unknown) => error,
    );
    expect(previewErrorMessage(denied)).toMatch(/permission/i);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Requested resource is unavailable.", code: "unavailable" },
          { status: 503 },
        ),
      ),
    );
    const unavailable = await fetchArtifactPreviewText("art-1").catch(
      (error: unknown) => error,
    );
    expect(previewErrorMessage(unavailable)).toBe(
      "Artifact content is unavailable.",
    );
  });
});

describe("parseJsonPreview", () => {
  it("parses valid JSON and reports invalid JSON", () => {
    expect(parseJsonPreview('{"ok":true}')).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(parseJsonPreview("not-json")).toEqual({ ok: false });
  });
});
