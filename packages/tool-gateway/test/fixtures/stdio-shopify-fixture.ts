#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { serveStdio } from "@osva-ai/connector-sdk";

const TEST_GRAPHQL_ENV = "OSVA_CONNECTOR_SHOPIFY_TEST_GRAPHQL_URL";
const CONNECTORS_ROOT_ENV = "OSVA_CONNECTORS_ROOT";

function resolveConnectorsDist(packageName: "shopify"): string {
  const root = process.env[CONNECTORS_ROOT_ENV]?.trim();
  if (root === undefined || root.length === 0) {
    throw new Error(
      `Shopify test stdio fixture requires ${CONNECTORS_ROOT_ENV} (built osva-connectors checkout).`,
    );
  }
  return path.join(path.resolve(root), "packages", packageName, "dist");
}

function assertLoopbackHttpUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${label} must use http.`);
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} must target loopback.`);
  }
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function loadDistModule<T>(distDir: string, name: string): Promise<T> {
  return (await import(pathToFileURL(path.join(distDir, name)).href)) as T;
}

const rawGraphql = process.env[TEST_GRAPHQL_ENV]?.trim();
if (rawGraphql === undefined || rawGraphql.length === 0) {
  throw new Error(
    `Shopify test stdio fixture requires ${TEST_GRAPHQL_ENV} (loopback GraphQL mock URL).`,
  );
}

const graphqlEndpoint = assertLoopbackHttpUrl(
  rawGraphql,
  "Shopify test GraphQL URL",
);
const distDir = resolveConnectorsDist("shopify");

const { loadShopifyConfig } = await loadDistModule<{
  loadShopifyConfig: (env: NodeJS.ProcessEnv) => {
    accessToken: string;
    requestTimeoutMs: number;
  };
}>(distDir, "config.js");
const { createShopifyConnector } = await loadDistModule<{
  createShopifyConnector: (options: {
    client: unknown;
    accessToken: string;
  }) => Parameters<typeof serveStdio>[0];
}>(distDir, "connector.js");
const { createShopifyGraphqlClient } = await loadDistModule<{
  createShopifyGraphqlClient: (options: {
    graphqlEndpoint: string;
    accessToken: string;
    requestTimeoutMs: number;
  }) => unknown;
}>(distDir, "shopify-graphql-client.js");

const config = loadShopifyConfig(process.env);
const client = createShopifyGraphqlClient({
  graphqlEndpoint,
  accessToken: config.accessToken,
  requestTimeoutMs: config.requestTimeoutMs,
});

await serveStdio(
  createShopifyConnector({
    client,
    accessToken: config.accessToken,
  }),
);
