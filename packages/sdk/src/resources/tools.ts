import type { ToolId, ToolVersionId } from "@osva-ai/contracts";
import {
  toolListResourceSchema,
  toolResourceSchema,
  toolVersionListResourceSchema,
  toolVersionResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type ToolListResource = z.infer<typeof toolListResourceSchema>;
type ToolResource = z.infer<typeof toolResourceSchema>;
type ToolVersionListResource = z.infer<typeof toolVersionListResourceSchema>;
type ToolVersionResource = z.infer<typeof toolVersionResourceSchema>;

export class ToolsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<ToolListResource> {
    return this.client.request({ method: "GET", path: "/v1/tools" });
  }

  get(toolId: ToolId): Promise<ToolResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/tools/${encodeURIComponent(toolId)}`,
    });
  }

  listVersions(toolId: ToolId): Promise<ToolVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/tools/${encodeURIComponent(toolId)}/versions`,
    });
  }

  getVersion(
    toolId: ToolId,
    toolVersionId: ToolVersionId,
  ): Promise<ToolVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/tools/${encodeURIComponent(toolId)}/versions/${encodeURIComponent(toolVersionId)}`,
    });
  }
}
