import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  agentListResourceSchema,
  agentResourceSchema,
  agentVersionListResourceSchema,
  agentVersionResourceSchema,
  createAgentRequestSchema,
  createAgentVersionRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type AgentListResource = z.infer<typeof agentListResourceSchema>;
type AgentResource = z.infer<typeof agentResourceSchema>;
type AgentVersionListResource = z.infer<typeof agentVersionListResourceSchema>;
type AgentVersionResource = z.infer<typeof agentVersionResourceSchema>;
type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
type CreateAgentVersionRequest = z.infer<
  typeof createAgentVersionRequestSchema
>;

export class AgentsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<AgentListResource> {
    return this.client.request({ method: "GET", path: "/v1/agents" });
  }

  get(agentId: AgentId): Promise<AgentResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/agents/${encodeURIComponent(agentId)}`,
    });
  }

  create(input: CreateAgentRequest): Promise<AgentResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/agents",
      body: input,
    });
  }

  listVersions(agentId: AgentId): Promise<AgentVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
    });
  }

  getVersion(
    agentId: AgentId,
    agentVersionId: AgentVersionId,
  ): Promise<AgentVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`,
    });
  }

  createVersion(
    agentId: AgentId,
    input: CreateAgentVersionRequest,
  ): Promise<AgentVersionResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
      body: input,
    });
  }
}
