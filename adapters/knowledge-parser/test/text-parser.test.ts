import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { OsvaKnowledgeParserRegistry } from "../src/registry.js";

describe("OsvaKnowledgeParserRegistry", () => {
  const registry = new OsvaKnowledgeParserRegistry();

  it("parses plain text into ordered segments", async () => {
    const parser = registry.resolve("text/plain");
    const segments: { ordinal: number; text: string }[] = [];
    for await (const segment of parser.parse({
      content: Readable.from(["alpha\n\nbeta"]),
      mediaType: "text/plain",
    })) {
      segments.push({ ordinal: segment.ordinal, text: segment.text });
    }
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.ordinal).toBe(1);
  });

  it("rejects unsupported media types", () => {
    expect(() => registry.resolve("application/zip")).toThrow();
  });
});
