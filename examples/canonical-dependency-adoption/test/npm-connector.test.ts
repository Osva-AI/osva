import {
  ConnectorSdkError,
  createMcpServerFromConnector,
} from "@osva-ai/connector-sdk";
import { describe, expect, it } from "vitest";

import { createCanonicalNpmResearchConnector } from "../mcp/npm-connector/src/connector.js";
import {
  createNpmClient,
  NPM_DOWNLOADS_ORIGIN,
  NPM_REGISTRY_ORIGIN,
  normalizeDownloadsDocument,
  normalizeRegistryDocument,
  type FetchLike,
} from "../mcp/npm-connector/src/npm-client.js";
import {
  NPM_DOWNLOADS_PERIOD_LAST_MONTH,
  parseDownloadsInput,
  parsePackageMetadataInput,
} from "../mcp/npm-connector/src/schemas.js";

function jsonResponse(
  status: number,
  body: unknown,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function mockFetch(
  handler: (url: URL) => Response | Promise<Response>,
): FetchLike {
  return async (input) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
    return handler(url);
  };
}

describe("canonical npm MCP connector definition", () => {
  it("registers npm_package_metadata and npm_downloads with expected schemas", () => {
    const connector = createCanonicalNpmResearchConnector({
      client: createNpmClient({ fetch: async () => jsonResponse(500, {}) }),
    });

    expect(connector.metadata.key).toBe("canonical-npm-research");
    expect(connector.tools.map((tool) => tool.name)).toEqual([
      "npm_package_metadata",
      "npm_downloads",
    ]);

    const metadataTool = connector.tools[0];
    const downloadsTool = connector.tools[1];
    expect(metadataTool?.inputSchema).toMatchObject({
      required: ["packageName"],
    });
    expect(downloadsTool?.inputSchema).toMatchObject({
      required: ["packageName", "period"],
      properties: {
        period: { enum: [NPM_DOWNLOADS_PERIOD_LAST_MONTH] },
      },
    });

    expect(() => createMcpServerFromConnector(connector)).not.toThrow();
  });
});

describe("npm_package_metadata", () => {
  it("normalizes an unscoped package from the registry", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.origin).toBe(NPM_REGISTRY_ORIGIN);
      expect(url.pathname).toBe("/zod");
      return jsonResponse(200, {
        name: "zod",
        "dist-tags": { latest: "4.6.5" },
        license: "MIT",
        repository: { url: "git+https://github.com/colinhacks/zod.git" },
        time: { "4.6.5": "2026-03-01T00:00:00.000Z" },
        maintainers: [{ name: "a" }, { name: "b" }],
      });
    });

    const client = createNpmClient({ fetch: fetchImpl });
    await expect(client.fetchPackageMetadata("zod")).resolves.toEqual({
      name: "zod",
      latestVersion: "4.6.5",
      license: "MIT",
      repositoryUrl: "https://github.com/colinhacks/zod",
      modifiedAt: "2026-03-01T00:00:00.000Z",
      maintainersCount: 2,
    });
  });

  it("URL-encodes scoped package names", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toBe("/%40scope%2Fpkg");
      return jsonResponse(200, {
        name: "@scope/pkg",
        "dist-tags": { latest: "1.0.0" },
      });
    });

    const client = createNpmClient({ fetch: fetchImpl });
    await expect(client.fetchPackageMetadata("@scope/pkg")).resolves.toEqual({
      name: "@scope/pkg",
      latestVersion: "1.0.0",
    });
  });

  it("omits optional fields when registry data does not provide them", async () => {
    const normalized = normalizeRegistryDocument("minimal", {
      name: "minimal",
      "dist-tags": { latest: "1.0.0" },
    });
    expect(normalized).toEqual({
      name: "minimal",
      latestVersion: "1.0.0",
    });
  });

  it("surfaces deprecated latest versions", async () => {
    const normalized = normalizeRegistryDocument("legacy", {
      name: "legacy",
      "dist-tags": { latest: "2.0.0" },
      versions: {
        "2.0.0": { deprecated: "Package no longer supported." },
      },
    });
    expect(normalized.deprecated).toBe("Package no longer supported.");
  });

  it("returns PACKAGE_NOT_FOUND on registry 404", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(404, { error: "Not found" })),
    });
    await expect(
      client.fetchPackageMetadata("does-not-exist-example"),
    ).rejects.toMatchObject({
      code: "PACKAGE_NOT_FOUND",
      message: 'npm package "does-not-exist-example" was not found.',
    });
  });

  it("returns retryable rate limit errors on HTTP 429", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(429, { error: "Too Many Requests" })),
    });
    await expect(client.fetchPackageMetadata("zod")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("returns retryable upstream failures on HTTP 500", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(500, { error: "Server Error" })),
    });
    await expect(client.fetchPackageMetadata("zod")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects malformed registry payloads missing dist-tags.latest", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() =>
        jsonResponse(200, { name: "broken", "dist-tags": {} }),
      ),
    });
    await expect(client.fetchPackageMetadata("broken")).rejects.toMatchObject({
      code: "INVALID_UPSTREAM",
    });
  });

  it("trims surrounding whitespace in tool input", async () => {
    expect(parsePackageMetadataInput({ packageName: "  zod  " })).toEqual({
      packageName: "zod",
    });

    const connector = createCanonicalNpmResearchConnector({
      client: createNpmClient({
        fetch: mockFetch((url) => {
          expect(url.pathname).toBe("/zod");
          return jsonResponse(200, {
            name: "zod",
            "dist-tags": { latest: "1.0.0" },
          });
        }),
      }),
    });

    const tool = connector.tools[0];
    await expect(
      tool?.handler({ packageName: "  zod  " }, {}),
    ).resolves.toEqual({
      name: "zod",
      latestVersion: "1.0.0",
    });
  });
});

describe("npm_downloads", () => {
  it("normalizes downloads responses", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.origin).toBe(NPM_DOWNLOADS_ORIGIN);
      expect(url.pathname).toBe("/downloads/point/last-month/zod");
      return jsonResponse(200, {
        downloads: 123456,
        start: "2026-02-01",
        end: "2026-02-28",
        package: "zod",
      });
    });

    const client = createNpmClient({ fetch: fetchImpl });
    await expect(
      client.fetchDownloads("zod", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).resolves.toEqual({
      packageName: "zod",
      period: "last-month",
      downloads: 123456,
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("uses the npm downloads API last-month point endpoint (UTC dates supplied by npm)", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toBe("/downloads/point/last-month/zod");
      return jsonResponse(200, {
        downloads: 1,
        start: "2026-01-01",
        end: "2026-01-31",
        package: "zod",
      });
    });

    const client = createNpmClient({ fetch: fetchImpl });
    const result = await client.fetchDownloads(
      "zod",
      NPM_DOWNLOADS_PERIOD_LAST_MONTH,
    );
    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2026-01-31");
  });

  it("URL-encodes scoped package names for downloads", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.pathname).toBe("/downloads/point/last-month/%40scope%2Fpkg");
      return jsonResponse(200, {
        downloads: 10,
        start: "2026-02-01",
        end: "2026-02-28",
        package: "@scope/pkg",
      });
    });

    const client = createNpmClient({ fetch: fetchImpl });
    await expect(
      client.fetchDownloads("@scope/pkg", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).resolves.toMatchObject({ packageName: "@scope/pkg", downloads: 10 });
  });

  it("accepts zero downloads", () => {
    expect(
      normalizeDownloadsDocument("quiet", NPM_DOWNLOADS_PERIOD_LAST_MONTH, {
        downloads: 0,
        start: "2026-02-01",
        end: "2026-02-28",
      }),
    ).toEqual({
      packageName: "quiet",
      period: "last-month",
      downloads: 0,
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("returns PACKAGE_NOT_FOUND on downloads 404", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(404, {})),
    });
    await expect(
      client.fetchDownloads("missing-pkg", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).rejects.toMatchObject({ code: "PACKAGE_NOT_FOUND" });
  });

  it("returns retryable rate limit errors on downloads 429", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(429, {})),
    });
    await expect(
      client.fetchDownloads("zod", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("returns retryable upstream failures on downloads 500", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(500, {})),
    });
    await expect(
      client.fetchDownloads("zod", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });

  it("rejects malformed downloads payloads", async () => {
    const client = createNpmClient({
      fetch: mockFetch(() => jsonResponse(200, { downloads: "many" })),
    });
    await expect(
      client.fetchDownloads("zod", NPM_DOWNLOADS_PERIOD_LAST_MONTH),
    ).rejects.toMatchObject({ code: "INVALID_UPSTREAM" });
  });

  it("rejects unsupported download periods at the tool input layer", () => {
    expect(() =>
      parseDownloadsInput({ packageName: "zod", period: "last-week" }),
    ).toThrow(ConnectorSdkError);
  });
});
