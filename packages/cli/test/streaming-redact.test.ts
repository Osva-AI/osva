import { describe, expect, it } from "vitest";

import { createStreamingSecretRedactor } from "../src/doctor/streaming-redact.js";

describe("streaming secret redaction", () => {
  it("redacts secrets split across chunks", () => {
    const parts: string[] = [];
    const redactor = createStreamingSecretRedactor((text) => {
      parts.push(text);
    });
    redactor.write("POSTGRES_PASS");
    redactor.write("WORD=abc123secretvalue\n");
    redactor.flush();
    expect(parts.join("")).toContain("POSTGRES_PASSWORD=***");
    expect(parts.join("")).not.toContain("abc123secretvalue");
  });

  it("redacts long installation secrets split mid-value", () => {
    const secret = "a".repeat(64);
    const parts: string[] = [];
    const redactor = createStreamingSecretRedactor((text) => {
      parts.push(text);
    });
    redactor.write(`POSTGRES_PASSWORD=${secret.slice(0, 40)}`);
    redactor.write(`${secret.slice(40)}\n`);
    redactor.flush();
    expect(parts.join("")).toContain("POSTGRES_PASSWORD=***");
    expect(parts.join("")).not.toContain(secret);
  });
});
