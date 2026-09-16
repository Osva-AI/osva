import { describe, expect, it } from "vitest";

import { isCanonicalJsonValue } from "../src/json-value.js";
import {
  isRelativeTrustedEntrypoint,
  isSha256IntegrityDigest,
} from "../src/trusted-runtime.js";

describe("canonical JSON values", () => {
  it("accepts JSON primitives, arrays, and plain objects", () => {
    expect(isCanonicalJsonValue(null)).toBe(true);
    expect(isCanonicalJsonValue({ echoed: true, count: 1 })).toBe(true);
    expect(isCanonicalJsonValue(["a", 1, false, null])).toBe(true);
  });

  it("rejects functions, symbols, bigint, cyclic objects, and class instances", () => {
    expect(isCanonicalJsonValue(() => undefined)).toBe(false);
    expect(isCanonicalJsonValue(Symbol("x"))).toBe(false);
    expect(isCanonicalJsonValue(1n)).toBe(false);
    expect(isCanonicalJsonValue(Number.NaN)).toBe(false);
    expect(isCanonicalJsonValue(new Date())).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isCanonicalJsonValue(cyclic)).toBe(false);
  });
});

describe("trusted runtime entrypoint and integrity", () => {
  it("accepts relative POSIX entrypoints", () => {
    expect(isRelativeTrustedEntrypoint("echo-agent.ts")).toBe(true);
    expect(isRelativeTrustedEntrypoint("agents/echo-agent.ts")).toBe(true);
  });

  it("rejects absolute and traversing entrypoints", () => {
    expect(isRelativeTrustedEntrypoint("/tmp/echo-agent.ts")).toBe(false);
    expect(isRelativeTrustedEntrypoint("../echo-agent.ts")).toBe(false);
    expect(isRelativeTrustedEntrypoint("C:/echo-agent.ts")).toBe(false);
  });

  it("accepts sha256 integrity digests", () => {
    expect(isSha256IntegrityDigest(`sha256:${"c".repeat(64)}`)).toBe(true);
    expect(isSha256IntegrityDigest("sha256:abcd")).toBe(false);
  });
});
