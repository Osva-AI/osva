import type { WorkspaceId } from "@osva/contracts";
import { OsvaClient } from "@osva/sdk";

export interface OsvaClientFactory {
  forWorkspace(workspaceId: WorkspaceId): OsvaClient;
}

export function createOsvaClientFactory(baseUrl: string): OsvaClientFactory {
  return {
    forWorkspace(workspaceId) {
      return new OsvaClient({
        baseUrl,
        workspaceId,
      });
    },
  };
}
