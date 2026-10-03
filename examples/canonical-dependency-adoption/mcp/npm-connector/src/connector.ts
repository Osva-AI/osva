import {
  defineConnector,
  defineTool,
  type DefinedConnector,
} from "@osva-ai/connector-sdk";

import { createNpmClient, type NpmClient } from "./npm-client.js";
import {
  NPM_DOWNLOADS_PERIOD_LAST_MONTH,
  parseDownloadsInput,
  parsePackageMetadataInput,
} from "./schemas.js";

const packageMetadataInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["packageName"],
  properties: {
    packageName: {
      type: "string",
      minLength: 1,
      description:
        "npm package name, including scoped names such as @scope/pkg.",
    },
  },
} as const;

const downloadsInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["packageName", "period"],
  properties: {
    packageName: {
      type: "string",
      minLength: 1,
      description:
        "npm package name, including scoped names such as @scope/pkg.",
    },
    period: {
      type: "string",
      enum: [NPM_DOWNLOADS_PERIOD_LAST_MONTH],
      description:
        "Download window. Canonical v1 supports last-month via the npm downloads API point endpoint.",
    },
  },
} as const;

export function createCanonicalNpmResearchConnector(options?: {
  readonly client?: NpmClient;
}): DefinedConnector {
  const client = options?.client ?? createNpmClient({});

  return defineConnector({
    key: "canonical-npm-research",
    name: "Canonical npm Research Connector",
    description:
      "Read-only npm registry and download metadata for the OSVA canonical dependency-adoption example.",
    version: "1.0.0",
    tools: [
      defineTool({
        name: "npm_package_metadata",
        description:
          "Fetch normalized metadata for an npm package from the public registry.",
        inputSchema: packageMetadataInputSchema,
        handler: async (input, context) => {
          const parsed = parsePackageMetadataInput(input);
          return client.fetchPackageMetadata(parsed.packageName, {
            signal: context.signal,
          });
        },
      }),
      defineTool({
        name: "npm_downloads",
        description:
          "Fetch normalized download counts for an npm package for the last-month period.",
        inputSchema: downloadsInputSchema,
        handler: async (input, context) => {
          const parsed = parseDownloadsInput(input);
          return client.fetchDownloads(parsed.packageName, parsed.period, {
            signal: context.signal,
          });
        },
      }),
    ],
  });
}

export const canonicalNpmResearchConnector =
  createCanonicalNpmResearchConnector();
