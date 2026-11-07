import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { startM20_7HumanConsoleStack } from "./m20-7-live-harness.js";
import { consoleJson, startM12_3HumanConsoleStack } from "./m12-3-harness.js";
import {
  grantOwnerAdminOnWorkspaceB,
  provisionM20_6OpenAiModelProfilesAsOwner,
} from "./m20-6-builder-helpers.js";

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

  it("R: acceptance artifacts include unique run id field contract", () => {
    const report = readFileSync(
      path.join(REPO_ROOT, "scripts/acceptance/m20-7/lib/report.mjs"),
      "utf8",
    );
    expect(report).toContain("randomUUID");
  });
});
