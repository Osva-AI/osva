import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const liveSmokeManifest = JSON.parse(
  readFileSync(
    path.join(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
      "scripts/acceptance/m20-7/scenarios/live-smoke-manifest.json",
    ),
    "utf8",
  ),
) as {
  operations: Array<{ id: string; userInstruction?: string }>;
};

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@osva/db";

import {
  resetM12_3Data,
  startM12_3Infra,
  stopM12_3Infra,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import { provisionM20_6OpenAiModelProfiles } from "./m20-6-builder-helpers.js";
import {
  assertLiveEndpointAllowed,
  provisionM20_7LiveModelProfiles,
  resolveM20_7LiveModelConfig,
} from "./m20-7-builder-helpers.js";
import {
  liveExecuteBlockedReason,
  m20_7BillableLiveExecuteEnv,
  m20_7NonBillableLiveExecuteEnv,
} from "./m20-7-live-guards.js";
import { startM20_7HumanConsoleStack } from "./m20-7-live-harness.js";
import { consoleJson, startM12_3HumanConsoleStack } from "./m12-3-harness.js";
import {
  consoleJsonWithHeaders,
  grantOwnerAdminOnWorkspaceB,
  provisionM20_6OpenAiModelProfilesAsOwner,
} from "./m20-6-builder-helpers.js";
import {
  parseLiveBuilderGenerationBody,
  providerEvidenceForScenario,
  recordLiveProvenanceFromGenerationHttp,
  sanitizeBuilderGenerationFailure,
} from "./m20-7-live-eval.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("M20.7 builder live harness regression (no billable providers)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("A: live-ready stack does not expose fake OpenAI listener", async () => {
    process.env.OPENAI_API_KEY =
      process.env.OPENAI_API_KEY ?? "sk-m20-7-test-key";
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "live-ready",
    });
    try {
      expect(stack.fakeOpenAI).toBeUndefined();
      expect(stack.forbiddenProviderOrigins.length).toBe(0);
    } finally {
      await stack.close();
    }
  });

  it("B/C: deterministic fake provisioning routes to fake origin", async () => {
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "deterministic",
    });
    try {
      expect(stack.fakeOpenAI).toBeDefined();
      const models = await provisionM20_6OpenAiModelProfiles(
        stack as unknown as import("./m12-3-harness.js").M12_3Stack,
        stack.workspaceA,
      );
      expect(models.generationModelProfileVersionId).toBeTruthy();
      const versions = await consoleJson(
        stack as unknown as import("./m12-3-harness.js").M12_3Stack,
        stack.workspaceA,
        "/api/v1/model-provider-connections",
      );
      expect(versions.status).toBe(200);
    } finally {
      await stack.close();
    }
  });

  it("D: live endpoint guard rejects fake origin", async () => {
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "deterministic",
    });
    try {
      expect(stack.fakeOpenAI).toBeDefined();
      expect(() =>
        assertLiveEndpointAllowed(stack, stack.fakeOpenAI!.origin),
      ).toThrow(/FAKE_PROVIDER/);
    } finally {
      await stack.close();
    }
  });

  it("E: live provisioning uses official endpoint on live-ready stack", async () => {
    process.env.OPENAI_API_KEY = "sk-m20-7-test-key";
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "live-ready",
    });
    try {
      const bundle = await provisionM20_7LiveModelProfiles(
        stack,
        stack.workspaceA,
        resolveM20_7LiveModelConfig(),
      );
      expect(bundle.connectionVersionId.length).toBeGreaterThan(0);
    } finally {
      await stack.close();
    }
  });

  it("H: cross-workspace model profile rejected (reuse M20.6 safety)", async () => {
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    try {
      await provisionM20_6OpenAiModelProfiles(stack, stack.workspaceA);
      await grantOwnerAdminOnWorkspaceB(database, stack);
      const modelsB = await provisionM20_6OpenAiModelProfilesAsOwner(
        stack,
        stack.workspaceB,
      );
      const callsBefore = stack.fakeOpenAI.requests.length;
      const res = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/builder/proposals/generate",
        {
          method: "POST",
          body: {
            userInstruction: "OSVA_M20_6_SCENARIO=simple",
            generationModelProfileVersionId:
              modelsB.generationModelProfileVersionId,
          },
        },
      );
      expect(res.status).toBe(422);
      expect(stack.fakeOpenAI.requests.length).toBe(callsBefore);
    } finally {
      await stack.close();
    }
  });

  it("G: live-smoke NL without fixture marker surfaces 422 builder failure after fake provider call", async () => {
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "deterministic",
    });
    try {
      expect(stack.fakeOpenAI).toBeDefined();
      const models = await provisionM20_6OpenAiModelProfiles(
        stack as unknown as import("./m12-3-harness.js").M12_3Stack,
        stack.workspaceA,
      );
      const op = liveSmokeManifest.operations.find(
        (row) => row.id === "workflow-generation",
      );
      expect(op?.userInstruction).toBeTruthy();
      const callsBefore = stack.fakeOpenAI!.requests.length;
      const res = await consoleJsonWithHeaders(
        stack,
        "/api/v1/builder/proposals/generate",
        stack.consoleHeaders(stack.workspaceA),
        {
          method: "POST",
          body: {
            userInstruction: op!.userInstruction!,
            generationModelProfileVersionId:
              models.generationModelProfileVersionId,
          },
        },
      );
      expect(res.status).toBe(422);
      expect(stack.fakeOpenAI!.requests.length).toBeGreaterThan(callsBefore);
      const parsed = parseLiveBuilderGenerationBody(res.status, res.body);
      expect(parsed?.ok).toBe(false);
      expect(parsed?.metadata?.attempts).toBeGreaterThan(0);
      expect(typeof parsed?.errorCode).toBe("string");
      const provenance = {
        liveModeRequested: false,
        liveModeAuthorized: false,
        actualProviderCallsObserved: 0,
        providerInvocationAttemptsObserved: 0,
        providerIdentityVerified: false,
      };
      recordLiveProvenanceFromGenerationHttp(provenance, {
        httpStatus: res.status,
        parsed,
        provider: "OPENAI",
        modelId: "gpt-m20-6-builder",
        connectionVersionId: "fake",
        endpointBaseUrl: "https://api.openai.com/v1",
        forbiddenOrigins: stack.forbiddenProviderOrigins,
      });
      expect(provenance.providerInvocationAttemptsObserved).toBeGreaterThan(0);
      expect(provenance.actualProviderCallsObserved).toBe(
        provenance.providerInvocationAttemptsObserved,
      );
    } finally {
      await stack.close();
    }
  });

  it("I: provider HTTP 400 diagnostics survive BFF through acceptance artifact rows", async () => {
    const stack = await startM20_7HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      profile: "deterministic",
    });
    try {
      expect(stack.fakeOpenAI).toBeDefined();
      const models = await provisionM20_6OpenAiModelProfiles(
        stack as unknown as import("./m12-3-harness.js").M12_3Stack,
        stack.workspaceA,
      );
      const res = await consoleJsonWithHeaders(
        stack,
        "/api/v1/builder/proposals/generate",
        stack.consoleHeaders(stack.workspaceA),
        {
          method: "POST",
          body: {
            userInstruction: "openai-error-400",
            generationModelProfileVersionId:
              models.generationModelProfileVersionId,
          },
        },
      );
      expect(res.status).toBe(422);
      const parsed = parseLiveBuilderGenerationBody(res.status, res.body);
      expect(parsed?.ok).toBe(false);
      expect(parsed?.errorCode).toBe("PROVIDER_ERROR");
      expect(parsed?.providerDiagnostic).toMatchObject({
        providerHttpStatus: 400,
        providerErrorType: "invalid_request_error",
        providerErrorCode: "invalid_json_schema",
        providerErrorParam: "response_format",
        providerHttpResponseObserved: true,
      });
      expect(parsed?.providerDiagnostic?.modelGatewayErrorCode).toBeTruthy();

      const failure = sanitizeBuilderGenerationFailure(res.status, parsed!);
      const scenarioRow = {
        id: "provider-invalid-json-schema",
        status: "ERROR",
        structuralScore: 0,
        intentScore: 0,
        httpStatus: res.status,
        providerAttempts: parsed?.metadata?.attempts ?? 0,
        builderErrorCode: failure.builderErrorCode,
        builderMessage: failure.builderMessage,
        ...providerEvidenceForScenario({ failure, parsed }),
      };

      const artifactDir = path.join(REPO_ROOT, "artifacts", "m20-7");
      mkdirSync(artifactDir, { recursive: true });
      const acceptancePayload = {
        runId: randomUUID(),
        mode: "regression",
        results: [scenarioRow],
        generationFailure: failure,
        scenarioCount: 1,
      };
      writeFileSync(
        path.join(artifactDir, "acceptance-results.json"),
        JSON.stringify(acceptancePayload, null, 2),
      );

      const mergedLikeRunScript = {
        scenarios: acceptancePayload.results,
        generationFailure: acceptancePayload.generationFailure,
      };
      const scenario = mergedLikeRunScript.scenarios[0] as {
        providerDiagnostic?: {
          providerHttpStatus?: number;
          providerErrorCode?: string;
          providerErrorParam?: string;
          modelGatewayErrorCode?: string;
          providerHttpResponseObserved?: boolean;
        };
      };
      expect(scenario.providerDiagnostic).toMatchObject({
        providerHttpStatus: 400,
        providerErrorCode: "invalid_json_schema",
        providerErrorParam: "response_format",
        modelGatewayErrorCode: expect.any(String),
        providerHttpResponseObserved: true,
      });
      expect(
        mergedLikeRunScript.generationFailure.providerDiagnostic,
      ).toMatchObject({
        providerHttpStatus: 400,
        providerErrorCode: "invalid_json_schema",
      });
    } finally {
      await stack.close();
    }
  });

  it("F: billable guard blocked vs authorized explicit env configs", () => {
    const blocked = liveExecuteBlockedReason(m20_7NonBillableLiveExecuteEnv());
    expect(blocked).toBe("OSVA_M20_7_LIVE_EXECUTE not set");

    const missingAllow = liveExecuteBlockedReason(
      m20_7NonBillableLiveExecuteEnv({
        OSVA_M20_7_LIVE_EXECUTE: "1",
      }),
    );
    expect(missingAllow).toBe("OSVA_M20_7_ALLOW_BILLABLE not set");

    expect(
      liveExecuteBlockedReason(m20_7BillableLiveExecuteEnv()),
    ).toBeUndefined();
  });

  it("R: acceptance artifacts include unique run id field contract", () => {
    const report = readFileSync(
      path.join(REPO_ROOT, "scripts/acceptance/m20-7/lib/report.mjs"),
      "utf8",
    );
    expect(report).toContain("randomUUID");
  });
});
