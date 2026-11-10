import type {
  ModelProfileId,
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  ModelProviderConnection,
  ModelProviderConnectionRepository,
  ModelProviderConnectionVersion,
  ModelProfile,
  ModelProfileRepository,
} from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import { AnthropicProviderAdapter } from "@osva/adapters-model-anthropic";
import { startFakeAnthropicMessagesServer } from "../../model-anthropic/test/fake-anthropic-server.js";
import { ModelProviderConnectionResolver } from "../src/model-provider-connection-resolver.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Anthropic connection workspace header", () => {
  it("resolver forwards connection endpoint anthropicWorkspaceId to outbound headers", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);

    const workspaceId = "ws_test" as WorkspaceId;
    const connectionId = "mpc_test" as ModelProviderConnectionId;
    const versionId = "mpcv_test" as ModelProviderConnectionVersionId;
    const profileId = "mp_test" as ModelProfileId;

    const connectionVersion: ModelProviderConnectionVersion = {
      id: versionId,
      connectionId,
      version: 1,
      endpoint: {
        baseUrl: server.origin,
        anthropicWorkspaceId: "wrkspc_01ConnectionBound01",
        allowPrivateNetworks: true,
      },
      credentialRef: undefined,
      createdAt: new Date(),
    };
    const connection: ModelProviderConnection = {
      id: connectionId,
      workspaceId,
      key: "anthropic",
      name: "Anthropic",
      provider: "ANTHROPIC",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const profile: ModelProfile = {
      id: profileId,
      workspaceId,
      key: "builder",
      name: "Builder",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const connections: Pick<
      ModelProviderConnectionRepository,
      "findConnectionVersionById" | "findConnectionByWorkspaceAndId"
    > = {
      findConnectionVersionById: async () => connectionVersion,
      findConnectionByWorkspaceAndId: async () => connection,
    };
    const modelProfiles: Pick<ModelProfileRepository, "findModelProfileById"> =
      {
        findModelProfileById: async () => profile,
      };

    const resolver = new ModelProviderConnectionResolver({
      connections: connections as ModelProviderConnectionRepository,
      modelProfiles: modelProfiles as ModelProfileRepository,
      secretResolver: {
        resolve: async () => "test-key",
      },
      legacyProviders: {},
      policy: { envApiKeys: { ANTHROPIC: "env-fallback-key" } },
    });

    const adapter = await resolver.resolveForModelProfileVersion({
      modelProfileId: profileId,
      modelProviderConnectionVersionId: versionId,
      provider: "ANTHROPIC",
    });
    expect(adapter).toBeInstanceOf(AnthropicProviderAdapter);

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers["anthropic-workspace-id"]).toBe(
      "wrkspc_01ConnectionBound01",
    );
  });
});
