import { randomUUID } from "node:crypto";
import path from "node:path";

import { spawnSync } from "node:child_process";

import { getRepoRoot } from "./stack.js";
import { bearer, fetchJson } from "./b3-http.js";

export async function bootstrapWorkspace(connectionString, options = {}) {
  const seedScript = path.join(
    getRepoRoot(),
    "scripts/acceptance/m9-7b/fixtures/seed-workspace-admin.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [seedScript, connectionString, options.name ?? "Acceptance Workspace B"],
    {
      encoding: "utf8",
      env: { ...process.env, OSVA_DATABASE_URL: connectionString },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "workspace seed failed");
  }
  const parsed = JSON.parse(result.stdout.trim());
  return {
    token: parsed.token,
    workspaceId: parsed.workspaceId,
    apiKeyId: parsed.apiKeyId,
  };
}

export async function createApiKey(origin, adminToken, input) {
  return fetchJson(`${origin}/v1/api-keys`, {
    method: "POST",
    headers: { ...bearer(adminToken), "content-type": "application/json" },
    body: input,
  });
}

export async function provisionCommunityRoleKeys(origin, adminToken) {
  const roles = ["VIEWER", "OPERATOR", "EDITOR", "ADMIN"];
  const keys = {};
  for (const role of roles) {
    if (role === "ADMIN") {
      keys[role] = { token: adminToken, apiKeyId: "bootstrap-admin" };
      continue;
    }
    const created = await createApiKey(origin, adminToken, {
      name: `acceptance-${role.toLowerCase()}`,
      role,
    });
    if (created.status !== 201) {
      throw new Error(`Create ${role} key failed: ${created.status}`);
    }
    keys[role] = {
      token: created.body.token,
      apiKeyId: created.body.apiKey.id,
    };
  }
  return keys;
}
