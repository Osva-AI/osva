import type { McpPrincipal } from "@osva-ai/contracts";
import { OsvaClient } from "@osva-ai/sdk";

import {
  getMcpBearerCredential,
  getMcpPrincipal,
} from "./principal-context.js";

export interface OsvaClientFactory {
  forPrincipal(principal: McpPrincipal): OsvaClient;
}

export function createOsvaClientFactory(baseUrl: string): OsvaClientFactory {
  return {
    forPrincipal(principal) {
      const active = getMcpPrincipal();
      if (
        active.subjectId !== principal.subjectId ||
        active.workspaceId !== principal.workspaceId ||
        active.role !== principal.role
      ) {
        throw new Error("MCP principal mismatch for outbound REST client.");
      }
      return new OsvaClient({
        baseUrl,
        apiKey: getMcpBearerCredential(),
      });
    },
  };
}
