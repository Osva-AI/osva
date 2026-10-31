import type { ModelProfileId, ModelProfileVersionId } from "@osva-ai/contracts";
import {
  createModelProfileRequestSchema,
  createModelProfileVersionRequestSchema,
  modelProfileListResourceSchema,
  modelProfileResourceSchema,
  modelProfileVersionListResourceSchema,
  modelProfileVersionResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateModelProfileRequest = z.infer<
  typeof createModelProfileRequestSchema
>;
type CreateModelProfileVersionRequest = z.infer<
  typeof createModelProfileVersionRequestSchema
>;
type ModelProfileListResource = z.infer<typeof modelProfileListResourceSchema>;
type ModelProfileResource = z.infer<typeof modelProfileResourceSchema>;
type ModelProfileVersionListResource = z.infer<
  typeof modelProfileVersionListResourceSchema
>;
type ModelProfileVersionResource = z.infer<
  typeof modelProfileVersionResourceSchema
>;

export class ModelProfilesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<ModelProfileListResource> {
    return this.client.request({ method: "GET", path: "/v1/model-profiles" });
  }

  get(modelProfileId: ModelProfileId): Promise<ModelProfileResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}`,
    });
  }

  create(input: CreateModelProfileRequest): Promise<ModelProfileResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/model-profiles",
      body: input,
    });
  }

  listVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
    });
  }

  getVersion(
    modelProfileId: ModelProfileId,
    modelProfileVersionId: ModelProfileVersionId,
  ): Promise<ModelProfileVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions/${encodeURIComponent(modelProfileVersionId)}`,
    });
  }

  createVersion(
    modelProfileId: ModelProfileId,
    input: CreateModelProfileVersionRequest,
  ): Promise<ModelProfileVersionResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
      body: input,
    });
  }
}
