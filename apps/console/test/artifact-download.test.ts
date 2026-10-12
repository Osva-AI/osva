import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildArtifactDownloadHeaders,
  contentDispositionAttachment,
  filenameFromContentDisposition,
  parseConsoleArtifactId,
  pipeArtifactBodyToResponse,
  safeArtifactMediaType,
  safeContentLengthHeader,
  safeDigestHeader,
  sanitizeAttachmentFilename,
} from "../src/server/artifact-download.js";

describe("console artifact download helpers", () => {
  it("accepts ordinary artifact ids and rejects traversal or control characters", () => {
    expect(parseConsoleArtifactId("artifact-1")).toBe("artifact-1");
    expect(parseConsoleArtifactId(encodeURIComponent("report.md"))).toBe(
      "report.md",
    );
    expect(parseConsoleArtifactId("")).toBeUndefined();
    expect(parseConsoleArtifactId("has..dots")).toBeUndefined();
    expect(parseConsoleArtifactId("a/b")).toBeUndefined();
    expect(parseConsoleArtifactId("a\\b")).toBeUndefined();
    expect(parseConsoleArtifactId("id%00x")).toBeUndefined();
  });

  it("always builds an attachment Content-Disposition with a sanitized name", () => {
    expect(filenameFromContentDisposition('inline; filename="evil.html"')).toBe(
      "evil.html",
    );
    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''caf%C3%A9.md",
      ),
    ).toBe("café.md");

    const injected = contentDispositionAttachment("ok.md\r\nX-Injected: yes");
    expect(injected.startsWith("attachment;")).toBe(true);
    expect(injected).not.toMatch(/\r|\n/);
    expect(injected).not.toContain("X-Injected");

    expect(sanitizeAttachmentFilename("../../etc/passwd")).toBe(
      ".._.._etc_passwd",
    );
    expect(sanitizeAttachmentFilename("")).toBe("download");
  });

  it("forwards only safe media types, lengths, and digests", () => {
    expect(safeArtifactMediaType("text/markdown")).toBe("text/markdown");
    expect(safeArtifactMediaType("text/html")).toBe("text/html");
    expect(safeArtifactMediaType("text/html\r\nX-Injected: 1")).toBe(
      "application/octet-stream",
    );
    expect(safeArtifactMediaType("not-a-type")).toBe(
      "application/octet-stream",
    );

    expect(safeContentLengthHeader("12")).toBe("12");
    expect(safeContentLengthHeader("-1")).toBeUndefined();
    expect(safeContentLengthHeader("12\r\nX: 1")).toBeUndefined();

    const digest = `sha256:${"a".repeat(64)}`;
    expect(safeDigestHeader(digest)).toBe(digest);
    expect(safeDigestHeader("md5:abc")).toBeUndefined();
  });

  it("does not copy untrusted hop-by-hop headers into the download response", () => {
    const headers = buildArtifactDownloadHeaders({
      mediaType: "text/html",
      contentLength: "4",
      digest: `sha256:${"c".repeat(64)}`,
      filename: "page.html",
      requestId: "req-1",
    });

    expect(headers["Content-Disposition"]).toContain("attachment");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["Content-Type"]).toBe("text/html");
    expect(headers["x-osva-request-id"]).toBe("req-1");
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Location).toBeUndefined();
  });
});

describe("artifact body streaming", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
  });

  it("pipes original bytes without buffering the whole payload first", async () => {
    const payload = Buffer.alloc(64 * 1024, 0xab);
    const server = http.createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      void pipeArtifactBodyToResponse({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(payload.subarray(0, 32 * 1024));
            controller.enqueue(payload.subarray(32 * 1024));
            controller.close();
          },
        }),
        request,
        response,
      });
    });
    servers.push(server);
    const origin = await listen(server);

    const response = await fetch(`${origin}/download`);
    expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(payload)).toBe(true);
  });

  it("destroys a stalled stream after the idle timeout", async () => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      void pipeArtifactBodyToResponse({
        body: new ReadableStream<Uint8Array>({
          start() {
            // Intentionally never enqueues or closes.
          },
        }),
        request,
        response,
        idleTimeoutMs: 40,
      });
    });
    servers.push(server);
    const origin = await listen(server);

    await expect(fetch(`${origin}/download`)).rejects.toBeInstanceOf(Error);
  });

  it("cancels the upstream reader when the client disconnects", async () => {
    let cancelled = false;
    const server = http.createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      void pipeArtifactBodyToResponse({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([1]));
          },
          cancel() {
            cancelled = true;
          },
        }),
        request,
        response,
      });
    });
    servers.push(server);
    const origin = await listen(server);

    const response = await fetch(`${origin}/download`);
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cancelled).toBe(true);
  });
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server address");
  }
  return `http://127.0.0.1:${address.port}`;
}
