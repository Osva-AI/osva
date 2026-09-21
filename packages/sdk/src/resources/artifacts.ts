import type { ArtifactId } from "@osva/contracts";
import {
  artifactListResourceSchema,
  artifactResourceSchema,
  listArtifactsQuerySchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { DownloadResult, OsvaHttpClient } from "../http-client.js";

type ArtifactResource = z.infer<typeof artifactResourceSchema>;
type ArtifactListResource = z.infer<typeof artifactListResourceSchema>;
type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;

export interface CreateArtifactInput {
  readonly name: string;
  readonly content: Blob;
  readonly mediaType?: string;
  readonly metadata?: Record<string, unknown>;
  readonly expectedDigest?: string;
  readonly idempotencyKey?: string;
}

export class ArtifactsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(query: ListArtifactsQuery = {}): Promise<ArtifactListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/artifacts",
      query: {
        runId: query.runId,
        runAttemptId: query.runAttemptId,
        limit: query.limit,
        cursor: query.cursor,
      },
    });
  }

  get(artifactId: ArtifactId): Promise<ArtifactResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/artifacts/${encodeURIComponent(artifactId)}`,
    });
  }

  create(input: CreateArtifactInput): Promise<ArtifactResource> {
    const form = new FormData();
    form.set("name", input.name);
    if (input.mediaType !== undefined) {
      form.set("mediaType", input.mediaType);
    }
    if (input.metadata !== undefined) {
      form.set("metadata", JSON.stringify(input.metadata));
    }
    if (input.expectedDigest !== undefined) {
      form.set("expectedDigest", input.expectedDigest);
    }
    if (input.idempotencyKey !== undefined) {
      form.set("idempotencyKey", input.idempotencyKey);
    }
    form.set("file", input.content, input.name);

    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    return this.client.uploadMultipart({
      path: "/v1/artifacts",
      form,
      headers,
    });
  }

  download(artifactId: ArtifactId): Promise<DownloadResult> {
    return this.client.download({
      path: `/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
    });
  }
}
