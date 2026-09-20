import type { WorkspaceId } from "@osva/contracts";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("Artifact HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("uploads and downloads artifact bytes", async () => {
    const { server } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    servers.push(server);
    const origin = `http://127.0.0.1:${port}`;

    const payload = Uint8Array.from([0x00, 0x01, 0xff]);
    const form = new FormData();
    form.set("workspaceId", WORKSPACE_ID);
    form.set("name", "binary.bin");
    form.append("file", new Blob([payload]), "binary.bin");

    const created = await fetch(`${origin}/v1/artifacts`, {
      method: "POST",
      body: form,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      id: string;
      digest: string;
    };
    expect(createdBody.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const downloaded = await fetch(
      `${origin}/v1/artifacts/${createdBody.id}/content`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toContain(
      "attachment",
    );
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(bytes).toEqual(payload);

    const metadata = await fetch(`${origin}/v1/artifacts/${createdBody.id}`);
    expect(metadata.status).toBe(200);
    const metadataBody = (await metadata.json()) as { createdAt: string };
    expect(metadataBody.createdAt).toBe(TEST_NOW.toISOString());
  });

  it("accepts large chunked multipart uploads byte-for-byte", async () => {
    const { server } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    servers.push(server);
    const origin = `http://127.0.0.1:${port}`;

    const fileSize = 128 * 1024;
    const payload = Buffer.alloc(fileSize, 0xcd);
    const boundary = "----osva-http-chunked";
    const body = buildMultipartBody({
      boundary,
      workspaceId: WORKSPACE_ID,
      name: "chunked.bin",
      fileName: "chunked.bin",
      fileBytes: payload,
    });

    const created = await postChunkedMultipart(origin, body, boundary);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    expect(createdBody.id.length).toBeGreaterThan(0);

    const downloaded = await fetch(
      `${origin}/v1/artifacts/${createdBody.id}/content`,
    );
    expect(downloaded.status).toBe(200);
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    expect(bytes).toEqual(payload);
  }, 30_000);
});

function buildMultipartBody(input: {
  boundary: string;
  workspaceId: string;
  name: string;
  fileName: string;
  fileBytes: Buffer;
}): Buffer {
  const chunks: Buffer[] = [];
  const push = (value: string | Buffer) => {
    chunks.push(typeof value === "string" ? Buffer.from(value) : value);
  };

  push(
    `--${input.boundary}\r\n` +
      `Content-Disposition: form-data; name="workspaceId"\r\n\r\n` +
      `${input.workspaceId}\r\n`,
  );
  push(
    `--${input.boundary}\r\n` +
      `Content-Disposition: form-data; name="name"\r\n\r\n` +
      `${input.name}\r\n`,
  );
  push(
    `--${input.boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${input.fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  push(input.fileBytes);
  push(`\r\n--${input.boundary}--\r\n`);
  return Buffer.concat(chunks);
}

async function postChunkedMultipart(
  origin: string,
  body: Buffer,
  boundary: string,
): Promise<Response> {
  const url = new URL(`${origin}/v1/artifacts`);
  const chunkSize = 4096;

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "transfer-encoding": "chunked",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              headers: response.headers as Record<string, string>,
            }),
          );
        });
      },
    );

    request.on("error", reject);

    let offset = 0;
    const writeNext = (): void => {
      if (offset >= body.length) {
        request.end();
        return;
      }

      const end = Math.min(offset + chunkSize, body.length);
      const chunk = body.subarray(offset, end);
      offset = end;
      if (!request.write(chunk)) {
        request.once("drain", writeNext);
        return;
      }
      writeNext();
    };

    writeNext();
  });
}
