import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelProfileId, ModelProfileVersionId } from "@osva/contracts";
import {
  createModelProfileRequestSchema,
  createModelProfileVersionRequestSchema,
  modelProfileListResourceSchema,
  modelProfileResourceSchema,
  modelProfileVersionListResourceSchema,
  modelProfileVersionResourceSchema,
  updateModelProfileRequestSchema,
} from "@osva/contracts/schemas";
import type {
  ModelProfile,
  ModelProfileApplication,
  ModelProfileVersion,
} from "@osva/domain";
import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleModelProfileRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  modelProfiles: ModelProfileApplication,
): Promise<boolean> {
  const route = matchModelProfileRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchModelProfileRoute(
      request,
      response,
      method,
      route,
      modelProfiles,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ModelProfileRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly modelProfileId: ModelProfileId }
  | { readonly kind: "versions"; readonly modelProfileId: ModelProfileId }
  | {
      readonly kind: "version";
      readonly modelProfileId: ModelProfileId;
      readonly modelProfileVersionId: ModelProfileVersionId;
    };

async function dispatchModelProfileRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ModelProfileRoute,
  modelProfiles: ModelProfileApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await modelProfiles.listModelProfiles.execute(scope);
      sendJson(response, 200, toModelProfileListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createModelProfileRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await modelProfiles.createModelProfile.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toModelProfileResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method === "GET") {
      const profile = await modelProfiles.getModelProfile.execute(
        scope,
        route.modelProfileId,
      );
      sendJson(response, 200, toModelProfileResource(profile));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateModelProfileRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await modelProfiles.updateModelProfileMetadata.execute(
        scope,
        {
          modelProfileId: route.modelProfileId,
          name: parsed.data.name,
        },
      );
      sendJson(response, 200, toModelProfileResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "versions") {
    if (method === "GET") {
      const versions = await modelProfiles.listModelProfileVersions.execute(
        scope,
        route.modelProfileId,
      );
      sendJson(response, 200, toModelProfileVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createModelProfileVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await modelProfiles.appendModelProfileVersion.execute(
        scope,
        {
          modelProfileId: route.modelProfileId,
          provider: parsed.data.provider,
          model: parsed.data.model,
          pricing: parsed.data.pricing,
        },
      );
      sendJson(response, 201, toModelProfileVersionResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (method === "GET") {
    const version = await modelProfiles.getModelProfileVersion.execute(scope, {
      modelProfileId: route.modelProfileId,
      modelProfileVersionId: route.modelProfileVersionId,
    });
    sendJson(response, 200, toModelProfileVersionResource(version));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchModelProfileRoute(path: string): ModelProfileRoute | undefined {
  if (path === "/v1/model-profiles" || path === "/v1/model-profiles/") {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/model-profiles/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/model-profiles/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: "item", modelProfileId: segments[0] as ModelProfileId };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "versions"
  ) {
    return { kind: "versions", modelProfileId: segments[0] as ModelProfileId };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "version",
      modelProfileId: segments[0] as ModelProfileId,
      modelProfileVersionId: segments[2] as ModelProfileVersionId,
    };
  }

  return undefined;
}

function toModelProfileResource(profile: ModelProfile) {
  return modelProfileResourceSchema.parse({
    id: profile.id,
    workspaceId: profile.workspaceId,
    key: profile.key,
    name: profile.name,
    createdAt: profile.createdAt.toISOString(),
  });
}

function toModelProfileListResource(profiles: readonly ModelProfile[]) {
  return modelProfileListResourceSchema.parse({
    modelProfiles: profiles.map((profile) => ({
      id: profile.id,
      workspaceId: profile.workspaceId,
      key: profile.key,
      name: profile.name,
      createdAt: profile.createdAt.toISOString(),
    })),
  });
}

function toModelProfileVersionResource(version: ModelProfileVersion) {
  return modelProfileVersionResourceSchema.parse({
    id: version.id,
    modelProfileId: version.modelProfileId,
    version: version.version,
    provider: version.provider,
    model: version.model,
    pricing: version.pricing,
    createdAt: version.createdAt.toISOString(),
  });
}

function toModelProfileVersionListResource(
  versions: readonly ModelProfileVersion[],
) {
  return modelProfileVersionListResourceSchema.parse({
    versions: versions.map((version) => ({
      id: version.id,
      modelProfileId: version.modelProfileId,
      version: version.version,
      provider: version.provider,
      model: version.model,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/model-profiles" },
  { method: "POST", path: "/v1/model-profiles" },
  { method: "GET", path: "/v1/model-profiles/:modelProfileId" },
  { method: "PATCH", path: "/v1/model-profiles/:modelProfileId" },
  { method: "GET", path: "/v1/model-profiles/:modelProfileId/versions" },
  { method: "POST", path: "/v1/model-profiles/:modelProfileId/versions" },
  {
    method: "GET",
    path: "/v1/model-profiles/:modelProfileId/versions/:modelProfileVersionId",
  },
] as const;
