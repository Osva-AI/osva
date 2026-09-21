import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { parseArtifactMultipartUpload } from "../src/artifact-multipart.js";

describe("parseArtifactMultipartUpload", () => {
  it("does not buffer the entire file in a single in-memory concat", async () => {
    const concatSpy = vi.spyOn(Buffer, "concat");
    const boundary = "----osva-test-boundary";
    const fileSize = 256 * 1024;
    const fileChunkSize = 512;
    const fileBody = Buffer.alloc(fileSize, 0xab);

    const { request, pushBody } = createMultipartRequest(boundary);
    pushBody(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="name"\r\n\r\n` +
        `large.bin\r\n`,
    );
    pushBody(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="large.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    );

    for (let offset = 0; offset < fileBody.length; offset += fileChunkSize) {
      pushBody(fileBody.subarray(offset, offset + fileChunkSize));
    }

    pushBody(`\r\n--${boundary}--\r\n`);
    pushBody(null);

    let uploadPromise: Promise<void> | undefined;
    const received: Buffer[] = [];

    await parseArtifactMultipartUpload(
      request,
      `multipart/form-data; boundary=${boundary}`,
      fileSize + 1024,
      {
        onUploadReady(_fields, fileStream) {
          uploadPromise = (async () => {
            for await (const chunk of fileStream) {
              received.push(Buffer.from(chunk));
            }
          })();
        },
      },
    );

    await uploadPromise;

    const largeConcat = concatSpy.mock.calls.find((call) => {
      const buffers = call[0];
      if (!Array.isArray(buffers)) {
        return false;
      }
      const total = buffers.reduce(
        (sum, buffer) => sum + (Buffer.isBuffer(buffer) ? buffer.length : 0),
        0,
      );
      return total >= fileSize;
    });
    concatSpy.mockRestore();

    expect(Buffer.concat(received)).toEqual(fileBody);
    expect(largeConcat).toBeUndefined();
  }, 15_000);
});

function createMultipartRequest(boundary: string): {
  request: IncomingMessage;
  pushBody: (chunk: Buffer | string | null) => void;
} {
  const stream = new PassThrough();
  const request = Object.assign(stream, {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    method: "POST",
  }) as unknown as IncomingMessage;

  return {
    request,
    pushBody(chunk: Buffer | string | null) {
      if (chunk === null) {
        stream.end();
        return;
      }
      stream.write(chunk);
    },
  };
}
