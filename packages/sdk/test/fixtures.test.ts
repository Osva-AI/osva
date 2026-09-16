import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runtimeExecuteRequestSchema,
  runtimeExecuteResponseSchema,
  runtimeModelGenerateTextRequestSchema,
  runtimeModelGenerateTextResponseSchema,
  runtimeToolInvokeRequestSchema,
  runtimeToolInvokeResponseSchema,
} from "@osva/runtime-protocol";

import { RUNTIME_PROTOCOL_FIXTURES_DIR } from "./fixtures-path.js";

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await fs.readFile(path.join(RUNTIME_PROTOCOL_FIXTURES_DIR, name), "utf8"),
  );
}

describe("shared Runtime Protocol fixtures", () => {
  it("accepts valid execute and capability fixtures", async () => {
    expect(
      runtimeExecuteRequestSchema.safeParse(
        await readFixture("execute-request.valid.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeExecuteResponseSchema.safeParse(
        await readFixture("execute-response.success.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeExecuteResponseSchema.safeParse(
        await readFixture("execute-response.failure.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeModelGenerateTextRequestSchema.safeParse(
        await readFixture("model-generate-text-request.valid.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeModelGenerateTextResponseSchema.safeParse(
        await readFixture("model-generate-text-response.success.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeToolInvokeRequestSchema.safeParse(
        await readFixture("tool-invoke-request.valid.json"),
      ).success,
    ).toBe(true);
    expect(
      runtimeToolInvokeResponseSchema.safeParse(
        await readFixture("tool-invoke-response.success.json"),
      ).success,
    ).toBe(true);
  });

  it("rejects invalid execute fixtures", async () => {
    expect(
      runtimeExecuteRequestSchema.safeParse(
        await readFixture("execute-request.invalid-missing-protocol.json"),
      ).success,
    ).toBe(false);
    expect(
      runtimeExecuteRequestSchema.safeParse(
        await readFixture("execute-request.invalid-protocol-version.json"),
      ).success,
    ).toBe(false);
  });
});
