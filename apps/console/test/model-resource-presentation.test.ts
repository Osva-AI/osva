import { describe, expect, it } from "vitest";

import {
  formatConnectionCredentialStatus,
  formatConnectionEndpointSummary,
  formatModelProviderLabel,
  summarizeConnectionVersionOption,
} from "../src/client/lib/model-resource-presentation";

describe("model-resource-presentation", () => {
  it("formats known providers", () => {
    expect(formatModelProviderLabel("OPENAI")).toBe("OpenAI");
    expect(formatModelProviderLabel("CUSTOM")).toBe("CUSTOM");
  });

  it("summarizes endpoint and credential state without exposing secrets", () => {
    expect(formatConnectionEndpointSummary({})).toBe("Provider default");
    expect(
      formatConnectionEndpointSummary({
        endpoint: { baseUrl: "https://example.com/v1" },
      }),
    ).toBe("https://example.com/v1");
    expect(formatConnectionCredentialStatus({})).toBe("Not set");
    expect(
      formatConnectionCredentialStatus({ credential: { configured: true } }),
    ).toBe("Configured");
  });

  it("builds human-readable connection version labels", () => {
    expect(
      summarizeConnectionVersionOption({
        connectionName: "Prod OpenAI",
        version: {
          id: "ver-1",
          connectionId: "conn-1",
          version: 2,
          provider: "OPENAI",
          endpoint: { baseUrl: "https://api.example/v1" },
          credential: { configured: true },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toContain("Prod OpenAI");
    expect(
      summarizeConnectionVersionOption({
        connectionName: "Prod OpenAI",
        version: {
          id: "ver-1",
          connectionId: "conn-1",
          version: 2,
          provider: "OPENAI",
          endpoint: { baseUrl: "https://api.example/v1" },
          credential: { configured: true },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toContain("Configured");
  });
});
