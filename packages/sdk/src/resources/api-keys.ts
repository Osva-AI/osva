import {
  apiKeyListResourceSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  revokeApiKeyResponseSchema,
} from "@osva/contracts/schemas";
import type { ApiKeyId } from "@osva/contracts";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;
type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
type ApiKeyListResource = z.infer<typeof apiKeyListResourceSchema>;
type RevokeApiKeyResponse = z.infer<typeof revokeApiKeyResponseSchema>;

export class ApiKeysResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<ApiKeyListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/api-keys",
    });
  }

  create(input: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.client.request({
      method: "POST",
      path: "/v1/api-keys",
      body: input,
    });
  }

  revoke(apiKeyId: ApiKeyId): Promise<RevokeApiKeyResponse> {
    return this.client.request({
      method: "POST",
      path: `/v1/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
    });
  }
}
