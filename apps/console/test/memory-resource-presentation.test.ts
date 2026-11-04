import { describe, expect, it } from "vitest";

import {
  MEMORY_RECORD_PREVIEW_MAX_CHARS,
  describeMemoryAccessMode,
  formatMemoryAccessModeLabel,
  memoryRecordValueKind,
  summarizeMemoryRecordPreview,
} from "../src/client/lib/memory-resource-presentation";

describe("memory-resource-presentation", () => {
  it("describes access modes for operators", () => {
    expect(formatMemoryAccessModeLabel("READ_ONLY")).toBe("Read only");
    expect(formatMemoryAccessModeLabel("READ_WRITE")).toBe("Read & write");
    expect(describeMemoryAccessMode("READ_ONLY")).toMatch(/memory gateway/i);
  });

  it("truncates large record previews without exposing full payload in summary", () => {
    const longString = "x".repeat(MEMORY_RECORD_PREVIEW_MAX_CHARS + 40);
    const summary = summarizeMemoryRecordPreview({ token: longString });
    expect(summary.isTruncated).toBe(true);
    expect(summary.preview.endsWith("…")).toBe(true);
    expect(summary.preview).not.toContain(longString);
  });

  it("classifies nested record shapes", () => {
    expect(memoryRecordValueKind({ a: 1, b: 2 })).toBe("object (2 keys)");
    expect(memoryRecordValueKind(["a", "b"])).toBe("array (2 items)");
    expect(memoryRecordValueKind("short")).toBe("string (5 chars)");
  });

  it("handles unbroken long strings in preview length", () => {
    const value = { secret: "a".repeat(200) };
    const summary = summarizeMemoryRecordPreview(value);
    expect(summary.fullLength).toBeGreaterThan(MEMORY_RECORD_PREVIEW_MAX_CHARS);
    expect(summary.isTruncated).toBe(true);
  });
});
