import type { SecretReference, SecretResolver } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { toMcpConnectorExecutionConfig } from "@osva/domain";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import { createTestWebApplication } from "./test-web.js";

const BEARER_SENTINEL = "DO_NOT_LEAK_SECRET_REF_9f18b7";
const STDIO_SENTINEL = "DO_NOT_LEAK_STDIO_REF_71ae21";

class CountingSecretResolver implements SecretResolver {
  resolveCount = 0;

  constructor(private readonly values: Readonly<Record<string, string>>) {}

  async resolve(reference: SecretReference): Promise<string> {
    this.resolveCount += 1;
    const value = this.values[reference.key];
    if (value === undefined) {
      throw new Error(`missing secret ${reference.key}`);
    }
    return value;
  }
}

describe("connector public secret redaction", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("redacts secret reference keys from REST responses but retains execution config", async () => {
    const countingResolver = new CountingSecretResolver({
      [BEARER_SENTINEL]: "bearer-value",
      [STDIO_SENTINEL]: "stdio-value",
    });
    const ctx = await createTestWebApplication({
      secrets: {
        [BEARER_SENTINEL]: "bearer-value",
        [STDIO_SENTINEL]: "stdio-value",
      },
      secretResolver: countingResolver,
      stdioConnectorsEnabled: true,
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    setTestAuthHeaders(ctx.testApiKey);

    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: { key: "redact", name: "Redact" },
    });

    const httpVersion = await fetchJson(
      `${origin}/v1/connectors/id-1/versions`,
      {
        method: "POST",
        body: {
          kind: "MCP",
          transport: "STREAMABLE_HTTP",
          transportConfig: { endpointUrl: "https://example.com/mcp" },
          auth: {
            type: "BEARER",
            tokenSecret: { key: BEARER_SENTINEL },
          },
        },
      },
    );
    expect(httpVersion.status).toBe(201);

    const stdioVersion = await fetchJson(
      `${origin}/v1/connectors/id-1/versions`,
      {
        method: "POST",
        body: {
          kind: "MCP",
          transport: "STDIO",
          transportConfig: {
            command: "echo",
            args: ["ok"],
            secretEnvironment: {
              TOKEN: { key: STDIO_SENTINEL },
            },
          },
        },
      },
    );
    expect(stdioVersion.status).toBe(201);

    countingResolver.resolveCount = 0;
    const listed = await fetchJson(`${origin}/v1/connectors/id-1/versions`);
    const loaded = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/id-2`,
    );
    const listConnectors = await fetchJson(`${origin}/v1/connectors`);

    const payloads = [
      JSON.stringify(httpVersion.body),
      JSON.stringify(stdioVersion.body),
      JSON.stringify(listed.body),
      JSON.stringify(loaded.body),
      JSON.stringify(listConnectors.body),
    ];
    for (const payload of payloads) {
      expect(payload).not.toContain(BEARER_SENTINEL);
      expect(payload).not.toContain(STDIO_SENTINEL);
      expect(payload).not.toContain("bearer-value");
      expect(payload).not.toContain("stdio-value");
    }
    expect(countingResolver.resolveCount).toBe(0);

    const httpVersionId = (httpVersion.body as { id: string }).id;
    const stored = await ctx.connectors.findConnectorVersionById(
      httpVersionId as import("@osva/contracts").ConnectorVersionId,
    );
    expect(stored).not.toBeNull();
    const execution = toMcpConnectorExecutionConfig(stored!);
    expect(JSON.stringify(execution)).toContain(BEARER_SENTINEL);
  });
});
