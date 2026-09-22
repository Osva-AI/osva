import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import { helmVersion, runHelm } from "../deployment/helm-cli.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CHART_DIR = path.join("deploy", "helm", "osva");

const DEFAULT_VALUES = path.join(
  REPO_ROOT,
  "scripts",
  "verification",
  "helm-default-values.yaml",
);
const PRODUCTION_VALUES = path.join(
  REPO_ROOT,
  "scripts",
  "verification",
  "helm-production-values.yaml",
);

function writeDefaultValues() {
  fs.writeFileSync(
    DEFAULT_VALUES,
    [
      "database:",
      "  url: postgres://osva:example@postgres.example.invalid:5432/osva",
      "valkey:",
      "  url: redis://valkey.example.invalid:6379",
      "image:",
      "  repository: osva",
      "  tag: test-1",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeProductionValues() {
  fs.writeFileSync(
    PRODUCTION_VALUES,
    [
      "database:",
      "  url: postgres://osva:example@postgres.example.invalid:5432/osva",
      "valkey:",
      "  url: redis://valkey.example.invalid:6379",
      "image:",
      "  repository: registry.example.invalid/osva",
      "  tag: prod-1",
      "existingSecret: osva-secrets",
      "extraEnvFrom:",
      "  - secretRef:",
      "      name: osva-secrets",
      "artifactStorage:",
      "  driver: s3",
      "  s3:",
      "    bucket: osva-artifacts-example",
      "    region: us-east-1",
      "    endpoint: https://s3.example.invalid",
      "    forcePathStyle: true",
      "ingress:",
      "  enabled: true",
      "  className: nginx",
      "  web:",
      "    host: osva.example.com",
      "  mcp:",
      "    enabled: true",
      "    host: mcp.example.com",
      "mcp:",
      "  allowedHosts:",
      "    - mcp.example.com",
      "",
    ].join("\n"),
    "utf8",
  );
}

function extractMigrationJobManifest(output) {
  const documents = output
    .split(/^---\s*$/m)
    .filter((doc) => doc.trim().length > 0);
  const job = documents.find((doc) =>
    /app\.kubernetes\.io\/component: migrate/.test(doc),
  );
  if (!job) {
    throw new Error("migration Job manifest not found in helm template output");
  }
  return job;
}

function assertMigrationJobLifecycle(job, { existingSecret = false } = {}) {
  assert.match(job, /helm\.sh\/hook: pre-install,pre-upgrade/);
  assert.match(job, /name: migrate/);
  assert.match(job, /(\["migrate"\]|- migrate)/);
  assert.match(job, /automountServiceAccountToken: false/);
  assert.doesNotMatch(job, /configMapRef/);
  assert.doesNotMatch(job, /serviceAccountName:/);
  assert.doesNotMatch(job, /bootstrap/);
  assert.doesNotMatch(job, /OSVA_VALKEY_URL/);
  if (existingSecret) {
    assert.match(job, /secretRef:\s*\n\s*name: osva-secrets/);
    assert.doesNotMatch(job, /- name: OSVA_DATABASE_URL\s*\n\s*value:/);
  } else {
    assert.match(job, /- name: OSVA_DATABASE_URL/);
    assert.match(
      job,
      /value: "?postgres:\/\/osva:example@postgres\.example\.invalid:5432\/osva"?/,
    );
  }
}

function assertDefaultTemplate(output) {
  assert.match(output, /kind: Job/);
  assert.match(output, /helm\.sh\/hook: pre-install/);
  assert.match(output, /image: osva:test-1/);
  assertMigrationJobLifecycle(extractMigrationJobManifest(output));
  assert.match(output, /OSVA_CONTAINER_ENABLED: "false"/);
  assert.match(output, /replicas: 1/);
  assert.match(output, /path: \/health/);
  assert.match(output, /path: \/ready/);
  assert.match(output, /allowPrivilegeEscalation: false/);
  assert.match(output, /runAsNonRoot: true/);
  assert.doesNotMatch(output, /hostPath:/);
  assert.doesNotMatch(output, /docker\.sock/);
  assert.doesNotMatch(output, /privileged: true/);
  assert.doesNotMatch(output, /kind: StatefulSet/);
  assert.doesNotMatch(output, /bitnami\/postgresql/);
}

function assertProductionTemplate(output) {
  assertMigrationJobLifecycle(extractMigrationJobManifest(output), {
    existingSecret: true,
  });
  assert.match(output, /OSVA_ARTIFACT_STORAGE_DRIVER: "s3"/);
  assert.match(output, /OSVA_ARTIFACT_S3_BUCKET: "osva-artifacts-example"/);
  assert.match(output, /OSVA_MCP_ALLOWED_HOSTS: "mcp.example.com"/);
  assert.match(output, /host: mcp\.example\.com/);
  assert.match(output, /secretRef:\s*\n\s*name: osva-secrets/);
  assert.doesNotMatch(output, /password: /i);
}

describe("helm chart packaging", () => {
  it("lints and templates default and production value sets via Docker Helm", () => {
    const version = helmVersion();
    console.log(`Helm via Docker: ${version}`);

    runHelm(["lint", CHART_DIR]);
    // lint uses chart values.yaml placeholders (no real credentials).

    writeDefaultValues();
    writeProductionValues();

    const defaultRender = runHelm([
      "template",
      "osva-default",
      CHART_DIR,
      "-f",
      path.relative(REPO_ROOT, DEFAULT_VALUES).replaceAll("\\", "/"),
    ]);
    assertDefaultTemplate(defaultRender);

    const productionRender = runHelm([
      "template",
      "osva-prod",
      CHART_DIR,
      "-f",
      path.relative(REPO_ROOT, PRODUCTION_VALUES).replaceAll("\\", "/"),
    ]);
    assertProductionTemplate(productionRender);

    fs.rmSync(DEFAULT_VALUES, { force: true });
    fs.rmSync(PRODUCTION_VALUES, { force: true });
  });
});
