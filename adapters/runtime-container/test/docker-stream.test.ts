import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { readDemuxedDockerStream } from "../src/docker-stream.js";

function frame(type: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe("readDemuxedDockerStream", () => {
  it("demuxes stdout and stderr frames", async () => {
    const stream = new PassThrough();
    const outputPromise = readDemuxedDockerStream(stream, {
      maxStdoutBytes: 1_024,
      maxStderrBytes: 1_024,
    });

    stream.write(frame(1, '{"outcome":"SUCCEEDED"}'));
    stream.write(frame(2, "warn"));
    stream.end();

    await expect(outputPromise).resolves.toEqual({
      stdout: '{"outcome":"SUCCEEDED"}',
      stderr: "warn",
      stdoutBytes: Buffer.byteLength('{"outcome":"SUCCEEDED"}', "utf8"),
      stderrBytes: Buffer.byteLength("warn", "utf8"),
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it("discards excess stderr without unbounded buffering", async () => {
    const stream = new PassThrough();
    const outputPromise = readDemuxedDockerStream(stream, {
      maxStdoutBytes: 32,
      maxStderrBytes: 8,
    });

    stream.write(frame(2, "0123456789abcdef"));
    stream.end();

    await expect(outputPromise).resolves.toMatchObject({
      stderr: "01234567",
      stderrBytes: 8,
      stderrTruncated: true,
    });
  });
});
