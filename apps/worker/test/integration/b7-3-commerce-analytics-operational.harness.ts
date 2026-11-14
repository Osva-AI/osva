import fs from "node:fs";
import path from "node:path";

import type { ConnectorVersionId, ToolVersionId } from "@osva-ai/contracts";

import {
  FAKE_GA4_ACCESS_TOKEN,
  MOCK_PROPERTY_ID,
} from "../../../../packages/tool-gateway/test/fixtures/mock-ga4-http-server.js";
import {
  FAKE_SHOPIFY_ACCESS_TOKEN,
  MOCK_SHOP,
} from "../../../../packages/tool-gateway/test/fixtures/mock-shopify-http-server.js";
import { resolveGa4ConnectorTestStdioEntry } from "../../../../packages/tool-gateway/test/fixtures/resolve-ga4-connector-test-entry.js";
import { resolveShopifyConnectorTestStdioEntry } from "../../../../packages/tool-gateway/test/fixtures/resolve-shopify-connector-test-entry.js";

import {
  buildStdioTransportConfig,
  discoverMcpTools,
  importMcpTools,
  registerStdioConnectorVersion,
  type StdioMcpTransportConfig,
} from "./b7-1-stdio-runtime-harness.js";

export const SHOPIFY_FIXTURE_SECRET_REF_KEY =
  "SHOPIFY_CONNECTOR_TEST_ACCESS_TOKEN";
export const SHOPIFY_LIVE_SECRET_REF_KEY = "B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN";
export const SHOPIFY_LIVE_SHOP_SECRET_REF_KEY = "B7_3_SHOPIFY_OPERATOR_SHOP";

export const GA4_LIVE_CREDENTIALS_PATH_REF_KEY =
  "B7_3_GA4_OPERATOR_CREDENTIALS_PATH";
export const GA4_LIVE_PROPERTY_SECRET_REF_KEY = "B7_3_GA4_OPERATOR_PROPERTY_ID";

export const SHOPIFY_SHOP_GET_REMOTE = "shopify.shop.get";
export const SHOPIFY_SHOP_GET_BINDING = "shopifyShopGet";

export const GA4_PROPERTY_GET_REMOTE = "ga4.property.get";
export const GA4_PROPERTY_GET_BINDING = "ga4PropertyGet";

export const COMMERCE_LEAK_MARKER = "DO_NOT_LEAK_IN_TOOL_OUTPUT";

export const FIXTURE_GA4_PROPERTY_ID = MOCK_PROPERTY_ID;
export const FIXTURE_SHOPIFY_SHOP = "osva-fixture.myshopify.com";

export function isB7_3FixtureStdioAvailable(): boolean {
  return (
    resolveShopifyFixtureStdioEntryOrUndefined() !== undefined &&
    resolveGa4FixtureStdioEntryOrUndefined() !== undefined
  );
}

function resolveShopifyFixtureStdioEntryOrUndefined(): string | undefined {
  const explicit = process.env.OSVA_B7_3_SHOPIFY_FIXTURE_STDIO_ENTRY?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(resolved) ? resolved : undefined;
  }
  return resolveShopifyConnectorTestStdioEntry();
}

function resolveGa4FixtureStdioEntryOrUndefined(): string | undefined {
  const explicit = process.env.OSVA_B7_3_GA4_FIXTURE_STDIO_ENTRY?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(resolved) ? resolved : undefined;
  }
  return resolveGa4ConnectorTestStdioEntry();
}

export function resolveShopifyFixtureStdioEntry(): string {
  const entry = resolveShopifyFixtureStdioEntryOrUndefined();
  if (entry === undefined) {
    throw new Error(
      "Shopify test stdio fixture not found. Build @osva/tool-gateway test fixtures and osva-connectors @osva-ai/connector-shopify dist.",
    );
  }
  return entry;
}

export function resolveGa4FixtureStdioEntry(): string {
  const entry = resolveGa4FixtureStdioEntryOrUndefined();
  if (entry === undefined) {
    throw new Error(
      "GA4 test stdio fixture not found. Build @osva/tool-gateway test fixtures and osva-connectors @osva-ai/connector-ga4 dist.",
    );
  }
  return entry;
}

function connectorsRootEnvironment():
  Readonly<Record<string, string>> | undefined {
  const root = process.env.OSVA_CONNECTORS_ROOT?.trim();
  if (root === undefined || root.length === 0) {
    return undefined;
  }
  return { OSVA_CONNECTORS_ROOT: root };
}

export function buildShopifyFixtureTransportConfig(input: {
  readonly stdioEntry: string;
  readonly graphqlUrl: string;
  readonly includeSecretReference?: boolean;
}): StdioMcpTransportConfig {
  const base = buildStdioTransportConfig(input.stdioEntry, {
    OSVA_CONNECTOR_SHOPIFY_SHOP: FIXTURE_SHOPIFY_SHOP,
    OSVA_CONNECTOR_SHOPIFY_TEST_GRAPHQL_URL: input.graphqlUrl,
    ...connectorsRootEnvironment(),
  });
  if (input.includeSecretReference === false) {
    return base;
  }
  return {
    ...base,
    secretEnvironment: {
      OSVA_CONNECTOR_SHOPIFY_ACCESS_TOKEN: {
        key: SHOPIFY_FIXTURE_SECRET_REF_KEY,
      },
    },
  };
}

export function buildGa4FixtureTransportConfig(input: {
  readonly stdioEntry: string;
  readonly dataApiOrigin: string;
  readonly adminApiOrigin: string;
}): StdioMcpTransportConfig {
  return buildStdioTransportConfig(input.stdioEntry, {
    OSVA_CONNECTOR_GA4_PROPERTY_ID: FIXTURE_GA4_PROPERTY_ID,
    OSVA_CONNECTOR_GA4_TEST_DATA_API_ORIGIN: input.dataApiOrigin,
    OSVA_CONNECTOR_GA4_TEST_ADMIN_API_ORIGIN: input.adminApiOrigin,
    ...connectorsRootEnvironment(),
  });
}

export function buildShopifyLiveTransportConfig(
  stdioEntry: string,
): StdioMcpTransportConfig {
  return {
    ...buildStdioTransportConfig(stdioEntry),
    secretEnvironment: {
      OSVA_CONNECTOR_SHOPIFY_ACCESS_TOKEN: {
        key: SHOPIFY_LIVE_SECRET_REF_KEY,
      },
      OSVA_CONNECTOR_SHOPIFY_SHOP: {
        key: SHOPIFY_LIVE_SHOP_SECRET_REF_KEY,
      },
    },
  };
}

export function buildGa4LiveTransportConfig(
  stdioEntry: string,
): StdioMcpTransportConfig {
  return {
    ...buildStdioTransportConfig(stdioEntry),
    secretEnvironment: {
      GOOGLE_APPLICATION_CREDENTIALS: {
        key: GA4_LIVE_CREDENTIALS_PATH_REF_KEY,
      },
      OSVA_CONNECTOR_GA4_PROPERTY_ID: {
        key: GA4_LIVE_PROPERTY_SECRET_REF_KEY,
      },
    },
  };
}

export function fixtureShopifyTokenEnv(
  value: string | undefined,
): Record<string, string> {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }
  return { [SHOPIFY_FIXTURE_SECRET_REF_KEY]: value };
}

export function liveDualLaneEnvPresent(): boolean {
  const shopifyToken = process.env[SHOPIFY_LIVE_SECRET_REF_KEY]?.trim() ?? "";
  const shopifyShop =
    process.env[SHOPIFY_LIVE_SHOP_SECRET_REF_KEY]?.trim() ?? "";
  const ga4Credentials =
    process.env[GA4_LIVE_CREDENTIALS_PATH_REF_KEY]?.trim() ?? "";
  const ga4Property =
    process.env[GA4_LIVE_PROPERTY_SECRET_REF_KEY]?.trim() ?? "";
  return (
    shopifyToken.length > 0 &&
    shopifyShop.length > 0 &&
    ga4Credentials.length > 0 &&
    ga4Property.length > 0
  );
}

export function isB7_3PublishedArtifactLaneEnabled(): boolean {
  return (
    process.env.OSVA_B7_3_PUBLISHED_ARTIFACT_LANE === "1" &&
    typeof process.env.OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY === "string" &&
    process.env.OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY.trim().length > 0 &&
    typeof process.env.OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY === "string" &&
    process.env.OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY.trim().length > 0 &&
    liveDualLaneEnvPresent()
  );
}

export function readPublishedShopifyStdioEntry(): string {
  const entry =
    process.env.OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  if (entry.length === 0) {
    throw new Error(
      "OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY is required for the published live lane.",
    );
  }
  return entry;
}

export function readPublishedGa4StdioEntry(): string {
  const entry = process.env.OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  if (entry.length === 0) {
    throw new Error(
      "OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY is required for the published live lane.",
    );
  }
  return entry;
}

export async function seedShopifyShopGetTool(input: {
  readonly origin: string;
  readonly transportConfig: StdioMcpTransportConfig;
  readonly connectorKey?: string;
}): Promise<{
  readonly connectorId: string;
  readonly connectorVersionId: ConnectorVersionId;
  readonly toolVersionId: ToolVersionId;
}> {
  const { connectorId, connectorVersionId } =
    await registerStdioConnectorVersion({
      origin: input.origin,
      connectorKey: input.connectorKey ?? "b7-3-shopify",
      connectorName: "B7.3 Shopify MCP",
      transportConfig: input.transportConfig,
    });
  const discovered = await discoverMcpTools(
    input.origin,
    connectorId,
    connectorVersionId,
  );
  if (
    !discovered.some((tool) => tool.remoteToolName === SHOPIFY_SHOP_GET_REMOTE)
  ) {
    throw new Error(
      `Expected ${SHOPIFY_SHOP_GET_REMOTE} in discovery: ${discovered.map((t) => t.remoteToolName).join(", ")}`,
    );
  }
  const imported = await importMcpTools({
    origin: input.origin,
    connectorVersionId,
    tools: [
      {
        remoteToolName: SHOPIFY_SHOP_GET_REMOTE,
        toolKey: SHOPIFY_SHOP_GET_BINDING,
        toolName: "Shopify shop get",
      },
    ],
  });
  return {
    connectorId,
    connectorVersionId,
    toolVersionId: imported[0]!.toolVersionId,
  };
}

export async function seedGa4PropertyGetTool(input: {
  readonly origin: string;
  readonly transportConfig: StdioMcpTransportConfig;
  readonly connectorKey?: string;
}): Promise<{
  readonly connectorId: string;
  readonly connectorVersionId: ConnectorVersionId;
  readonly toolVersionId: ToolVersionId;
}> {
  const { connectorId, connectorVersionId } =
    await registerStdioConnectorVersion({
      origin: input.origin,
      connectorKey: input.connectorKey ?? "b7-3-ga4",
      connectorName: "B7.3 GA4 MCP",
      transportConfig: input.transportConfig,
    });
  const discovered = await discoverMcpTools(
    input.origin,
    connectorId,
    connectorVersionId,
  );
  if (
    !discovered.some((tool) => tool.remoteToolName === GA4_PROPERTY_GET_REMOTE)
  ) {
    throw new Error(
      `Expected ${GA4_PROPERTY_GET_REMOTE} in discovery: ${discovered.map((t) => t.remoteToolName).join(", ")}`,
    );
  }
  const imported = await importMcpTools({
    origin: input.origin,
    connectorVersionId,
    tools: [
      {
        remoteToolName: GA4_PROPERTY_GET_REMOTE,
        toolKey: GA4_PROPERTY_GET_BINDING,
        toolName: "GA4 property get",
      },
    ],
  });
  return {
    connectorId,
    connectorVersionId,
    toolVersionId: imported[0]!.toolVersionId,
  };
}

export function assertFixtureCombinedOutput(output: unknown): void {
  if (output === null || typeof output !== "object") {
    throw new Error(`Expected combined output object, got ${String(output)}`);
  }
  const record = output as Record<string, unknown>;
  const shop = record.shop;
  const property = record.property;
  if (shop === null || typeof shop !== "object") {
    throw new Error("Expected shop object in combined output.");
  }
  const shopRecord = shop as Record<string, unknown>;
  if (shopRecord.name !== MOCK_SHOP.name) {
    throw new Error(`Unexpected shop name: ${String(shopRecord.name)}`);
  }
  if (property === null || typeof property !== "object") {
    throw new Error("Expected property object in combined output.");
  }
  const propertyRecord = property as Record<string, unknown>;
  if (
    typeof propertyRecord.displayName !== "string" ||
    propertyRecord.displayName.length === 0
  ) {
    throw new Error("Expected GA4 property displayName in combined output.");
  }
  if (typeof record.attributionNote !== "string") {
    throw new Error("Expected attributionNote in combined output.");
  }
}

export function assertNoCommerceSecretLeakInJson(
  payload: string,
  secrets: readonly string[],
): void {
  for (const secret of secrets) {
    if (secret.length > 0 && payload.includes(secret)) {
      throw new Error("Secret value leaked into JSON payload.");
    }
  }
  if (payload.includes(COMMERCE_LEAK_MARKER)) {
    throw new Error("Provider debug marker leaked into JSON payload.");
  }
}

export {
  FAKE_GA4_ACCESS_TOKEN,
  FAKE_SHOPIFY_ACCESS_TOKEN,
  MOCK_SHOP,
  MOCK_PROPERTY_ID,
};
