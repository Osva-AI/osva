#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { serveStdio } from "@osva-ai/connector-sdk";

const TEST_DATA_API_ENV = "OSVA_CONNECTOR_GA4_TEST_DATA_API_ORIGIN";
const TEST_ADMIN_API_ENV = "OSVA_CONNECTOR_GA4_TEST_ADMIN_API_ORIGIN";
const CONNECTORS_ROOT_ENV = "OSVA_CONNECTORS_ROOT";
const DEFAULT_FIXTURE_TOKEN = "ya29.osva_fixture_access_token_000000";

function resolveConnectorsDist(): string {
  const root = process.env[CONNECTORS_ROOT_ENV]?.trim();
  if (root === undefined || root.length === 0) {
    throw new Error(
      `GA4 test stdio fixture requires ${CONNECTORS_ROOT_ENV} (built osva-connectors checkout).`,
    );
  }
  return path.join(path.resolve(root), "packages", "ga4", "dist");
}

function assertLoopbackOrigin(raw: string, label: string): string {
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
  return url.origin;
}

async function loadDistModule<T>(distDir: string, name: string): Promise<T> {
  return (await import(pathToFileURL(path.join(distDir, name)).href)) as T;
}

const rawData = process.env[TEST_DATA_API_ENV]?.trim();
const rawAdmin = process.env[TEST_ADMIN_API_ENV]?.trim();
if (rawData === undefined || rawData.length === 0) {
  throw new Error(
    `GA4 test stdio fixture requires ${TEST_DATA_API_ENV} (loopback Data API mock origin).`,
  );
}
if (rawAdmin === undefined || rawAdmin.length === 0) {
  throw new Error(
    `GA4 test stdio fixture requires ${TEST_ADMIN_API_ENV} (loopback Admin API mock origin).`,
  );
}

const dataApiHost = assertLoopbackOrigin(rawData, "GA4 Data API origin");
const adminApiHost = assertLoopbackOrigin(rawAdmin, "GA4 Admin API origin");
const distDir = resolveConnectorsDist();

const { loadGa4Config } = await loadDistModule<{
  loadGa4Config: (env: NodeJS.ProcessEnv) => {
    defaultPropertyId?: string;
    requestTimeoutMs: number;
  };
}>(distDir, "config.js");
const { createGa4Connector } = await loadDistModule<{
  createGa4Connector: (options: {
    client: unknown;
    defaultPropertyId?: string;
  }) => Parameters<typeof serveStdio>[0];
}>(distDir, "connector.js");
const { createGa4RestClient } = await loadDistModule<{
  createGa4RestClient: (options: {
    tokenProvider: { getAccessToken: () => Promise<string> };
    requestTimeoutMs: number;
    dataApiHost: string;
    adminApiHost: string;
    accessTokenForRedaction?: string;
  }) => unknown;
}>(distDir, "ga4-rest-client.js");
const { createStaticBearerTokenProvider } = await loadDistModule<{
  createStaticBearerTokenProvider: (token: string) => {
    getAccessToken: () => Promise<string>;
  };
}>(distDir, "ga4-auth.js");

const fixtureToken = DEFAULT_FIXTURE_TOKEN;
const config = loadGa4Config(process.env);
const client = createGa4RestClient({
  tokenProvider: createStaticBearerTokenProvider(fixtureToken),
  requestTimeoutMs: config.requestTimeoutMs,
  dataApiHost,
  adminApiHost,
  accessTokenForRedaction: fixtureToken,
});

await serveStdio(
  createGa4Connector({
    client,
    ...(config.defaultPropertyId !== undefined
      ? { defaultPropertyId: config.defaultPropertyId }
      : {}),
  }),
);
