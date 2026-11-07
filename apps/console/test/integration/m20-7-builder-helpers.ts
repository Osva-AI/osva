import type { ModelProfileVersionId, WorkspaceId } from "@osva-ai/contracts";

import {
  consoleJsonWithHeaders,
  type M20_6ModelProfileBundle,
} from "./m20-6-builder-helpers.js";
import type { M20_7Stack } from "./m20-7-live-harness.js";

const OPENAI_OFFICIAL = "https://api.openai.com/v1";
const GEMINI_OFFICIAL = "https://generativelanguage.googleapis.com";

export interface M20_7LiveModelConfig {
  readonly provider: "OPENAI" | "GOOGLE_GEMINI";
  readonly generationModel: string;
  readonly executionModel: string;
  readonly alternateModel?: string;
}

export function resolveM20_7LiveModelConfig(): M20_7LiveModelConfig {
  const providerEnv = (
    process.env.OSVA_M20_7_LIVE_PROVIDER ?? "openai"
  ).toLowerCase();
  if (providerEnv === "gemini") {
    return {
      provider: "GOOGLE_GEMINI",
      generationModel:
        process.env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? "gemini-2.0-flash",
      executionModel:
        process.env.OSVA_M20_7_EXECUTION_MODEL?.trim() ?? "gemini-2.0-flash",
      alternateModel:
        process.env.OSVA_M20_7_ALTERNATE_MODEL?.trim() ?? "gemini-2.0-flash",
    };
  }
  return {
    provider: "OPENAI",
    generationModel:
      process.env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? "gpt-4o-mini",
    executionModel:
      process.env.OSVA_M20_7_EXECUTION_MODEL?.trim() ?? "gpt-4o-mini",
    alternateModel:
      process.env.OSVA_M20_7_ALTERNATE_MODEL?.trim() ?? "gpt-4o-mini",
  };
}

export function assertLiveEndpointAllowed(
  stack: M20_7Stack,
  baseUrl: string | undefined,
): void {
  if (baseUrl === undefined) {
    return;
  }
  const normalized = baseUrl.replace(/\/+$/, "");
  for (const forbidden of stack.forbiddenProviderOrigins) {
    if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
      throw new Error("FAKE_PROVIDER_ENDPOINT_IN_LIVE_MODE");
    }
  }
  if (normalized.includes("127.0.0.1") || normalized.includes("localhost")) {
    throw new Error("PRIVATE_ENDPOINT_IN_LIVE_MODE");
  }
}

export async function provisionM20_7LiveModelProfiles(
  stack: M20_7Stack,
  workspaceId: WorkspaceId,
  config: M20_7LiveModelConfig,
): Promise<M20_6ModelProfileBundle & { connectionVersionId: string }> {
  if (stack.profile !== "live-ready") {
    throw new Error("LIVE_PROVISION_REQUIRES_LIVE_READY_STACK");
  }

  const headers = stack.consoleHeaders(workspaceId);
  const request = async (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) => consoleJsonWithHeaders(stack, path, headers, init);

  const providerKey = config.provider === "OPENAI" ? "OPENAI" : "GOOGLE_GEMINI";
  const officialBase =
    config.provider === "OPENAI" ? OPENAI_OFFICIAL : GEMINI_OFFICIAL;
  assertLiveEndpointAllowed(stack, officialBase);

  const connection = await request("/api/v1/model-provider-connections", {
    method: "POST",
    body: {
      key: `m20-7-${providerKey.toLowerCase()}-${workspaceId}`,
      name: `M20.7 ${providerKey}`,
      provider: providerKey,
    },
  });
  if (connection.status !== 201) {
    throw new Error(`Connection create failed: ${connection.status}`);
  }
  const connectionId = (connection.body as { id: string }).id;

  const version = await request(
    `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
    {
      method: "POST",
      body: {
        endpoint: { baseUrl: officialBase },
        credentialRef: {
          key:
            config.provider === "OPENAI"
              ? "OPENAI_API_KEY"
              : "GOOGLE_GEMINI_API_KEY",
        },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(`Connection version failed: ${version.status}`);
  }
  const connectionVersionId = (version.body as { id: string }).id;
  const endpoint = (version.body as { endpoint?: { baseUrl?: string } })
    .endpoint?.baseUrl;
  assertLiveEndpointAllowed(stack, endpoint);

  const profile = await request("/api/v1/model-profiles", {
    method: "POST",
    body: { key: "builder-live", name: "Builder live models" },
  });
  if (profile.status !== 201) {
    throw new Error(`Model profile create failed: ${profile.status}`);
  }
  const modelProfileId = (profile.body as { id: string }).id;

  async function createMpv(model: string): Promise<ModelProfileVersionId> {
    if (/^gpt-m20-6-/.test(model)) {
      throw new Error("FIXTURE_MODEL_ID_IN_LIVE_MODE");
    }
    const mpv = await request(
      `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
      {
        method: "POST",
        body: {
          provider: providerKey,
          model,
          modelProviderConnectionVersionId: connectionVersionId,
        },
      },
    );
    if (mpv.status !== 201) {
      throw new Error(`Model profile version failed: ${mpv.status}`);
    }
    return (mpv.body as { id: string }).id as ModelProfileVersionId;
  }

  const generationModelProfileVersionId = await createMpv(
    config.generationModel,
  );
  const executionModelProfileVersionId = await createMpv(config.executionModel);
  const alternateModelProfileVersionId = await createMpv(
    config.alternateModel ?? config.generationModel,
  );

  return {
    generationModelProfileVersionId,
    executionModelProfileVersionId,
    alternateModelProfileVersionId,
    connectionVersionId,
  };
}
