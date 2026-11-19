import { describe, expect, it } from "vitest";

import {
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
  createDefaultInferenceResponseCachePolicy,
  type InferenceCacheLookupInput,
  type InferenceCacheStoreInput,
  type InferenceResponseCachePolicyV1,
  type ModelProfileVersionId,
  type ModelProviderConnectionVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";

import {
  buildInferenceCacheIdentity,
  evaluateInferenceCacheLookupEligibility,
  evaluateInferenceCacheStoreEligibility,
  inferenceCacheFailureLookupResult,
  assertCachePolicyWorkspace,
} from "../src/inference-cache/index.js";

const WORKSPACE_A = "ws_aaaaaaaaaaaaaaaa" as WorkspaceId;
const WORKSPACE_B = "ws_bbbbbbbbbbbbbbbb" as WorkspaceId;
const PROFILE_V1 = "mpv_aaaaaaaaaaaaaaaa" as ModelProfileVersionId;
const PROFILE_V2 = "mpv_bbbbbbbbbbbbbbbb" as ModelProfileVersionId;
const CONN_V1 = "mpcv_aaaaaaaaaaaaaaa" as ModelProviderConnectionVersionId;
const CONN_V2 = "mpcv_bbbbbbbbbbbbbbb" as ModelProviderConnectionVersionId;

function enabledPolicy(
  overrides: Partial<InferenceResponseCachePolicyV1> = {},
): InferenceResponseCachePolicyV1 {
  return {
    ...createDefaultInferenceResponseCachePolicy(),
    enabled: true,
    determinism: "REQUIRED_DETERMINISTIC",
    ...overrides,
  };
}

function baseLookup(
  overrides: Partial<InferenceCacheLookupInput> = {},
): InferenceCacheLookupInput {
  return {
    workspaceId: WORKSPACE_A,
    executionPurpose: "AGENT_RUN",
    modelProfileVersionId: PROFILE_V1,
    modelProviderConnectionVersionId: CONN_V1,
    provider: "OPENAI",
    configuredModelId: "gpt-test",
    messages: [{ role: "user", content: "hello" }],
    policy: enabledPolicy(),
    ...overrides,
  };
}

describe("inference cache foundation", () => {
  it("default policy keeps cache disabled", () => {
    const policy = createDefaultInferenceResponseCachePolicy();
    expect(policy.enabled).toBe(false);
    const decision = evaluateInferenceCacheLookupEligibility({
      ...baseLookup(),
      policy,
    });
    expect(decision).toEqual({ eligible: false, reason: "POLICY_DISABLED" });
  });

  it("requires explicit deterministic policy when enabled", () => {
    const decision = evaluateInferenceCacheLookupEligibility(
      baseLookup({
        policy: enabledPolicy({ determinism: "PROVIDER_DEFAULT" }),
      }),
    );
    expect(decision).toEqual({ eligible: false, reason: "NON_DETERMINISTIC" });
  });

  it("opts in only when enabled and deterministic", () => {
    const decision = evaluateInferenceCacheLookupEligibility(baseLookup());
    expect(decision).toEqual({ eligible: true, reason: "ELIGIBLE" });
  });

  it("isolates workspaces in identity and storage keys", () => {
    const material = {
      modelProfileVersionId: PROFILE_V1,
      modelProviderConnectionVersionId: CONN_V1,
      provider: "OPENAI" as const,
      configuredModelId: "gpt-test",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const a = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material,
    });
    const b = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_B,
      material,
    });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.identityDigest).not.toBe(b!.identityDigest);
    expect(a!.storageKey.startsWith(INFERENCE_CACHE_STORAGE_KEY_PREFIX)).toBe(
      true,
    );
    expect(a!.storageKey).toContain(WORKSPACE_A);
    expect(b!.storageKey).toContain(WORKSPACE_B);
    expect(a!.storageKey).not.toContain("hello");
  });

  it("changes identity when workspace cache policy revision changes", () => {
    const material = {
      modelProfileVersionId: PROFILE_V1,
      provider: "OPENAI" as const,
      configuredModelId: "gpt-test",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const before = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: { ...material, cachePolicyVersionId: "rev-a" },
    });
    const after = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: { ...material, cachePolicyVersionId: "rev-b" },
    });
    expect(before?.identityDigest).not.toBe(after?.identityDigest);
  });

  it("changes identity when model profile version changes", () => {
    const left = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const right = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V2,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(left?.identityDigest).not.toBe(right?.identityDigest);
  });

  it("changes identity when connection version changes", () => {
    const base = {
      modelProfileVersionId: PROFILE_V1,
      provider: "OPENAI" as const,
      configuredModelId: "gpt-test",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const withConn = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: { ...base, modelProviderConnectionVersionId: CONN_V1 },
    });
    const otherConn = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: { ...base, modelProviderConnectionVersionId: CONN_V2 },
    });
    const legacy = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: base,
    });
    expect(withConn?.identityDigest).not.toBe(otherConn?.identityDigest);
    expect(legacy?.identityDigest).not.toBe(withConn?.identityDigest);
    expect(legacy?.identityDigest).toMatch(
      /^inference-cache-identity-v1:sha256:[0-9a-f]{64}$/,
    );
  });

  it("produces stable canonical identities", () => {
    const input = {
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI" as const,
        configuredModelId: "gpt-test",
        messages: [{ role: "user" as const, content: "hello" }],
      },
    };
    const once = buildInferenceCacheIdentity(input)?.identityDigest;
    const twice = buildInferenceCacheIdentity(input)?.identityDigest;
    expect(once).toBe(twice);
  });

  it("differentiates message order and content", () => {
    const first = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [
          { role: "user", content: "one" },
          { role: "user", content: "two" },
        ],
      },
    });
    const swapped = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [
          { role: "user", content: "two" },
          { role: "user", content: "one" },
        ],
      },
    });
    expect(first?.identityDigest).not.toBe(swapped?.identityDigest);
  });

  it("differentiates schema, tools, and generation parameters", () => {
    const base = {
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI" as const,
        configuredModelId: "gpt-test",
        messages: [{ role: "user" as const, content: "hello" }],
      },
    };
    const plain = buildInferenceCacheIdentity(base)?.identityDigest;
    const tokens = buildInferenceCacheIdentity({
      ...base,
      material: { ...base.material, maxOutputTokens: 128 },
    })?.identityDigest;
    const schema = buildInferenceCacheIdentity({
      ...base,
      material: {
        ...base.material,
        jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    })?.identityDigest;
    const tools = buildInferenceCacheIdentity({
      ...base,
      material: {
        ...base.material,
        toolDefinitions: [
          {
            name: "ping",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    })?.identityDigest;
    expect(new Set([plain, tokens, schema, tools]).size).toBe(4);
  });

  it("rejects tool loops, judge calls, and tool definitions by default", () => {
    expect(
      evaluateInferenceCacheLookupEligibility(
        baseLookup({
          executionPurpose: "EVALUATION_JUDGE",
        }),
      ).reason,
    ).toBe("EVALUATION_JUDGE_FORBIDDEN");

    expect(
      evaluateInferenceCacheLookupEligibility(
        baseLookup({
          messages: [
            { role: "user", content: "run tool" },
            {
              role: "tool",
              toolCallId: "tc_1",
              name: "ping",
              content: "{}",
            },
          ],
        }),
      ).reason,
    ).toBe("TOOL_LOOP_FORBIDDEN");

    expect(
      evaluateInferenceCacheLookupEligibility(
        baseLookup({
          toolDefinitions: [
            { name: "ping", inputSchema: { type: "object", properties: {} } },
          ],
        }),
      ).reason,
    ).toBe("TOOL_DEFINITIONS_FORBIDDEN");
  });

  it("rejects failed, empty, and oversize store candidates", () => {
    const storeBase: InferenceCacheStoreInput = {
      ...baseLookup(),
      terminalStatus: "SUCCEEDED",
      response: { text: "ok" },
    };

    expect(
      evaluateInferenceCacheStoreEligibility({
        ...storeBase,
        terminalStatus: "SUCCEEDED",
        response: {},
      }).reason,
    ).toBe("RESPONSE_EMPTY");

    expect(
      evaluateInferenceCacheStoreEligibility({
        ...storeBase,
        response: { text: "x".repeat(300_000) },
      }).reason,
    ).toBe("REQUEST_INVALID");

    expect(
      evaluateInferenceCacheStoreEligibility({
        ...storeBase,
        cancelled: true,
        response: { text: "ok" },
      }).reason,
    ).toBe("RESPONSE_CANCELLED");
  });

  it("rejects incomplete identity material", () => {
    expect(
      buildInferenceCacheIdentity({
        workspaceId: "" as WorkspaceId,
        material: {
          modelProfileVersionId: PROFILE_V1,
          provider: "OPENAI",
          configuredModelId: "gpt-test",
          messages: [{ role: "user", content: "hello" }],
        },
      }),
    ).toBeUndefined();
    expect(
      evaluateInferenceCacheLookupEligibility(
        baseLookup({ configuredModelId: "" }),
      ).reason,
    ).toBe("IDENTITY_INCOMPLETE");
  });

  it("prevents workspace policy bypass", () => {
    expect(
      assertCachePolicyWorkspace(WORKSPACE_A, {
        ...enabledPolicy(),
        workspaceId: WORKSPACE_B,
      }),
    ).toEqual({ eligible: false, reason: "POLICY_NOT_AUTHORIZED" });
  });

  it("maps infrastructure failure to bypass without invoking provider", () => {
    expect(inferenceCacheFailureLookupResult()).toEqual({
      outcome: "bypass",
      reason: "INFRASTRUCTURE_UNAVAILABLE",
    });
  });

  it("keeps storage keys free of prompt plaintext", () => {
    const secretPrompt = "TOP_SECRET_DO_NOT_LOG";
    const identity = buildInferenceCacheIdentity({
      workspaceId: WORKSPACE_A,
      material: {
        modelProfileVersionId: PROFILE_V1,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [{ role: "user", content: secretPrompt }],
      },
    });
    expect(identity?.storageKey.includes(secretPrompt)).toBe(false);
    expect(identity?.identityDigest.includes(secretPrompt)).toBe(false);
  });
});
