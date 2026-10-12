import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

import { OSVA_DEFAULT_JSON_BODY_MAX_BYTES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  ConsoleInvalidJsonBodyError,
  ConsoleRequestBodyTooLargeError,
  readJsonBody,
} from "../src/server/read-json-body.js";
import { mapOsvaError } from "../src/server/console-http.js";

function incomingBody(chunks: readonly (string | Buffer)[]): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe("console JSON body limits", () => {
  it("parses JSON under the default limit and treats an empty body as {}", async () => {
    await expect(readJsonBody(incomingBody(['{"ok":true}']))).resolves.toEqual({
      ok: true,
    });
    await expect(readJsonBody(incomingBody([""]))).resolves.toEqual({});
  });

  it("rejects oversized bodies before JSON parse and maps them to 413", async () => {
    const oversized = "x".repeat(OSVA_DEFAULT_JSON_BODY_MAX_BYTES + 1);
    await expect(
      readJsonBody(incomingBody([oversized])),
    ).rejects.toBeInstanceOf(ConsoleRequestBodyTooLargeError);

    const mapped = mapOsvaError(new ConsoleRequestBodyTooLargeError());
    expect(mapped.status).toBe(413);
    expect(mapped.body.code).toBe("request_too_large");
    expect(mapped.body.error).not.toMatch(/osva_ak_|secret|Bearer/i);
  });

  it("rejects invalid JSON as 400 without treating it as an internal error", async () => {
    await expect(readJsonBody(incomingBody(["{"]))).rejects.toBeInstanceOf(
      ConsoleInvalidJsonBodyError,
    );

    const mapped = mapOsvaError(new ConsoleInvalidJsonBodyError());
    expect(mapped.status).toBe(400);
    expect(mapped.body.code).toBe("invalid_request");
  });
});
