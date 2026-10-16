import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AgentManifestV1 } from "@osva-ai/contracts";
import { isRelativeTrustedEntrypoint } from "@osva-ai/contracts";
import { agentManifestSchema } from "@osva-ai/contracts/schemas";

import { canonicalJson } from "./canonical-json.js";
import {
  sha256IntegrityOfFile,
  normalizeIntegrityDigest,
} from "./integrity.js";
import { validateJsonSchemaDocument } from "./json-schema-draft.js";
import {
  osvaAgentProjectSchema,
  type OsvaAgentProject,
} from "./project-config.js";
import { redactSecrets } from "../doctor/redact.js";
import {
  isInsideRoot,
  isSafeProjectRelativePath,
  resolvePathInsideRoot,
} from "./safe-path.js";
import type { ValidateCheck, ValidateReport } from "./types.js";

const BUILD_REMEDIATION = "Run npm run build, then npm run manifest.";
const MANIFEST_REMEDIATION = "Run npm run manifest after npm run build.";

export async function runValidatePipeline(
  projectDir: string,
): Promise<ValidateReport> {
  const checks: ValidateCheck[] = [];
  checks.push(
    passCheck("project_directory", `Using project directory ${projectDir}.`),
  );

  let projectConfig: OsvaAgentProject | undefined;
  const projectConfigPath = path.join(projectDir, "osva-agent.project.json");
  try {
    const raw = await readFile(projectConfigPath, "utf8");
    const parsed = osvaAgentProjectSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      checks.push(
        failCheck(
          "project_config",
          "osva-agent.project.json is invalid.",
          "Fix the project configuration file or re-run osva init.",
        ),
      );
      return finalizeReport(projectDir, checks);
    }
    projectConfig = parsed.data;
    checks.push(
      passCheck(
        "project_config",
        "osva-agent.project.json parsed successfully.",
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "osva-agent.project.json was not found."
        : "osva-agent.project.json could not be read.";
    checks.push(
      failCheck(
        "project_config",
        message,
        "Run osva init in this directory or use --project to point at a scaffold.",
      ),
    );
    return finalizeReport(projectDir, checks);
  }

  const contractChecks = await validateContractPaths(projectDir, projectConfig);
  checks.push(...contractChecks);
  if (contractChecks.some((check) => check.status === "FAIL")) {
    return finalizeReport(projectDir, checks);
  }

  const manifestPath = path.join(projectDir, "osva.manifest.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
    checks.push(passCheck("manifest_file", "osva.manifest.json is present."));
  } catch (error) {
    void error;
    checks.push(
      failCheck(
        "manifest_file",
        "osva.manifest.json was not found.",
        MANIFEST_REMEDIATION,
      ),
    );
    return finalizeReport(projectDir, checks);
  }

  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(manifestRaw) as unknown;
  } catch {
    checks.push(
      failCheck(
        "manifest_file",
        "osva.manifest.json is not valid JSON.",
        MANIFEST_REMEDIATION,
      ),
    );
    return finalizeReport(projectDir, checks);
  }

  const manifestSchemaResult = agentManifestSchema.safeParse(manifestParsed);
  if (!manifestSchemaResult.success) {
    checks.push(
      failCheck(
        "manifest_schema",
        "osva.manifest.json does not satisfy AgentManifestV1.",
        MANIFEST_REMEDIATION,
      ),
    );
    return finalizeReport(projectDir, checks);
  }
  const manifest = manifestSchemaResult.data as AgentManifestV1;
  checks.push(
    passCheck(
      "manifest_schema",
      "osva.manifest.json satisfies AgentManifestV1.",
    ),
  );

  if (manifest.runtime.type !== "TRUSTED_TYPESCRIPT") {
    checks.push(
      failCheck(
        "runtime_type",
        `Manifest runtime type must be TRUSTED_TYPESCRIPT (found ${manifest.runtime.type}).`,
        MANIFEST_REMEDIATION,
      ),
    );
    return finalizeReport(projectDir, checks);
  }
  checks.push(
    passCheck("runtime_type", "Manifest runtime type is TRUSTED_TYPESCRIPT."),
  );

  const entrypoint = manifest.runtime.entrypoint;
  if (!isRelativeTrustedEntrypoint(entrypoint)) {
    checks.push(
      failCheck(
        "runtime_entrypoint",
        "Manifest runtime.entrypoint must be a safe relative POSIX path.",
        MANIFEST_REMEDIATION,
      ),
    );
    return finalizeReport(projectDir, checks);
  }
  checks.push(
    passCheck(
      "runtime_entrypoint",
      `Manifest entrypoint "${entrypoint}" is a valid trusted runtime path.`,
    ),
  );

  const artifactCheck = await validateBuildArtifact(projectDir, entrypoint);
  checks.push(artifactCheck);
  if (artifactCheck.status === "FAIL") {
    return finalizeReport(projectDir, checks);
  }

  const artifactPath = resolvePathInsideRoot(
    projectDir,
    "dist",
    "agent",
    entrypoint,
  );
  const integrityCheck = await validateArtifactIntegrity(
    artifactPath,
    manifest.runtime.integrity,
  );
  checks.push(integrityCheck);

  const pathSafetyCheck = await validateArtifactPathSafety(
    projectDir,
    entrypoint,
  );
  checks.push(pathSafetyCheck);

  checks.push(validateProjectManifestAgreement(projectConfig, manifest));

  const schemaAgreement = await validateContractSchemaAgreement(
    projectDir,
    projectConfig,
    manifest,
  );
  checks.push(schemaAgreement);

  return finalizeReport(projectDir, checks);
}

async function validateContractPaths(
  projectDir: string,
  project: OsvaAgentProject,
): Promise<ValidateCheck[]> {
  const checks: ValidateCheck[] = [];
  const pairs = [
    {
      id: "input_schema",
      label: "Input schema",
      relative: project.contracts.input,
    },
    {
      id: "output_schema",
      label: "Output schema",
      relative: project.contracts.output,
    },
  ] as const;

  for (const pair of pairs) {
    if (!isSafeProjectRelativePath(pair.relative)) {
      checks.push(
        failCheck(
          pair.id,
          `${pair.label} path must be a safe relative path.`,
          "Use paths relative to the project root without .. traversal.",
        ),
      );
      continue;
    }

    let schemaPath: string;
    try {
      schemaPath = resolvePathInsideRoot(
        projectDir,
        ...pair.relative.split("/"),
      );
    } catch {
      checks.push(
        failCheck(
          pair.id,
          `${pair.label} path escapes the project directory.`,
          "Fix contracts.input or contracts.output in osva-agent.project.json.",
        ),
      );
      continue;
    }

    let schemaRaw: string;
    try {
      schemaRaw = await readFile(schemaPath, "utf8");
    } catch {
      checks.push(
        failCheck(
          pair.id,
          `${pair.label} file is missing at ${pair.relative}.`,
          "Restore the contract schema file or update osva-agent.project.json.",
        ),
      );
      continue;
    }

    let schemaDocument: unknown;
    try {
      schemaDocument = JSON.parse(schemaRaw) as unknown;
    } catch {
      checks.push(
        failCheck(
          pair.id,
          `${pair.label} file is not valid JSON.`,
          `Fix ${pair.relative}.`,
        ),
      );
      continue;
    }

    const draftResult = validateJsonSchemaDocument(schemaDocument, pair.label);
    if (!draftResult.ok) {
      checks.push(
        failCheck(
          pair.id,
          redactSecrets(draftResult.error ?? `${pair.label} is invalid.`),
          `Fix ${pair.relative}.`,
        ),
      );
      continue;
    }

    if (draftResult.warnMissingSchema) {
      checks.push(
        warnCheck(
          pair.id,
          `${pair.label} compiled but $schema is missing (expected draft 2020-12).`,
          `Add "$schema": "https://json-schema.org/draft/2020-12/schema" to ${pair.relative}.`,
        ),
      );
      continue;
    }

    checks.push(
      passCheck(pair.id, `${pair.label} is valid JSON Schema draft 2020-12.`),
    );
  }

  return checks;
}

async function validateBuildArtifact(
  projectDir: string,
  entrypoint: string,
): Promise<ValidateCheck> {
  let artifactPath: string;
  try {
    artifactPath = resolvePathInsideRoot(
      projectDir,
      "dist",
      "agent",
      entrypoint,
    );
  } catch {
    return failCheck(
      "build_artifact",
      "Build artifact path escapes the project directory.",
      BUILD_REMEDIATION,
    );
  }

  try {
    const info = await stat(artifactPath);
    if (!info.isFile()) {
      return failCheck(
        "build_artifact",
        `Build artifact at dist/agent/${entrypoint} is not a regular file.`,
        BUILD_REMEDIATION,
      );
    }
  } catch {
    return failCheck(
      "build_artifact",
      `Build artifact is missing at dist/agent/${entrypoint}.`,
      BUILD_REMEDIATION,
    );
  }

  return passCheck(
    "build_artifact",
    `Build artifact dist/agent/${entrypoint} exists.`,
  );
}

async function validateArtifactIntegrity(
  artifactPath: string,
  manifestIntegrity: string,
): Promise<ValidateCheck> {
  const expected = normalizeIntegrityDigest(manifestIntegrity);
  if (expected === undefined) {
    return failCheck(
      "artifact_integrity",
      "Manifest runtime.integrity is not a valid sha256 digest.",
      MANIFEST_REMEDIATION,
    );
  }

  const actual = await sha256IntegrityOfFile(artifactPath);
  if (actual !== expected) {
    return failCheck(
      "artifact_integrity",
      "Build artifact SHA-256 does not match manifest runtime.integrity.",
      BUILD_REMEDIATION,
    );
  }

  return passCheck(
    "artifact_integrity",
    "Build artifact SHA-256 matches manifest runtime.integrity.",
  );
}

async function validateArtifactPathSafety(
  projectDir: string,
  entrypoint: string,
): Promise<ValidateCheck> {
  let artifactPath: string;
  let agentDir: string;
  try {
    agentDir = resolvePathInsideRoot(projectDir, "dist", "agent");
    artifactPath = resolvePathInsideRoot(
      projectDir,
      "dist",
      "agent",
      entrypoint,
    );
  } catch {
    return failCheck(
      "artifact_path_safety",
      "Artifact path resolution failed.",
      BUILD_REMEDIATION,
    );
  }

  try {
    const projectReal = await realpath(projectDir);
    const agentDirReal = await realpath(agentDir);
    const artifactReal = await realpath(artifactPath);

    if (!isInsideRoot(projectReal, agentDirReal)) {
      return failCheck(
        "artifact_path_safety",
        "dist/agent resolves outside the project directory.",
        BUILD_REMEDIATION,
      );
    }
    if (!isInsideRoot(agentDirReal, artifactReal)) {
      return failCheck(
        "artifact_path_safety",
        "Build artifact resolves outside dist/agent.",
        BUILD_REMEDIATION,
      );
    }
  } catch {
    return failCheck(
      "artifact_path_safety",
      "Could not resolve build artifact path safely.",
      BUILD_REMEDIATION,
    );
  }

  return passCheck(
    "artifact_path_safety",
    "Build artifact path stays within dist/agent.",
  );
}

async function validateContractSchemaAgreement(
  projectDir: string,
  project: OsvaAgentProject,
  manifest: AgentManifestV1,
): Promise<ValidateCheck> {
  try {
    const inputPath = resolvePathInsideRoot(
      projectDir,
      ...project.contracts.input.split("/"),
    );
    const outputPath = resolvePathInsideRoot(
      projectDir,
      ...project.contracts.output.split("/"),
    );
    const inputSchema = JSON.parse(
      await readFile(inputPath, "utf8"),
    ) as unknown;
    const outputSchema = JSON.parse(
      await readFile(outputPath, "utf8"),
    ) as unknown;

    const mismatches: string[] = [];
    if (canonicalJson(inputSchema) !== canonicalJson(manifest.input.schema)) {
      mismatches.push("input schema");
    }
    if (canonicalJson(outputSchema) !== canonicalJson(manifest.output.schema)) {
      mismatches.push("output schema");
    }
    if (mismatches.length > 0) {
      return failCheck(
        "contract_schema_agreement",
        `Contract files disagree with manifest (${mismatches.join(", ")}).`,
        MANIFEST_REMEDIATION,
      );
    }
  } catch {
    return failCheck(
      "contract_schema_agreement",
      "Could not compare contract schemas with the manifest.",
      MANIFEST_REMEDIATION,
    );
  }

  return passCheck(
    "contract_schema_agreement",
    "Contract schema files match manifest input and output.",
  );
}

function validateProjectManifestAgreement(
  project: OsvaAgentProject,
  manifest: AgentManifestV1,
): ValidateCheck {
  if (manifest.runtime.type !== "TRUSTED_TYPESCRIPT") {
    return failCheck(
      "project_manifest_agreement",
      "Manifest runtime is not TRUSTED_TYPESCRIPT.",
      MANIFEST_REMEDIATION,
    );
  }

  const mismatches: string[] = [];
  if (project.key !== manifest.key) {
    mismatches.push("key");
  }
  if (project.name !== manifest.name) {
    mismatches.push("name");
  }
  if (project.runtime.entrypoint !== manifest.runtime.entrypoint) {
    mismatches.push("runtime.entrypoint");
  }
  if (canonicalJson(project.execution) !== canonicalJson(manifest.execution)) {
    mismatches.push("execution");
  }
  if (
    canonicalJson(project.capabilities) !== canonicalJson(manifest.capabilities)
  ) {
    mismatches.push("capabilities");
  }

  if (mismatches.length > 0) {
    return failCheck(
      "project_manifest_agreement",
      `Project configuration disagrees with manifest (${mismatches.join(", ")}).`,
      MANIFEST_REMEDIATION,
    );
  }

  return passCheck(
    "project_manifest_agreement",
    "Project configuration matches manifest identity and runtime settings.",
  );
}

function passCheck(id: string, message: string): ValidateCheck {
  return { id, status: "PASS", message: redactSecrets(message) };
}

function warnCheck(
  id: string,
  message: string,
  remediation: string,
): ValidateCheck {
  return {
    id,
    status: "WARN",
    message: redactSecrets(message),
    remediation: redactSecrets(remediation),
  };
}

function failCheck(
  id: string,
  message: string,
  remediation: string,
): ValidateCheck {
  return {
    id,
    status: "FAIL",
    message: redactSecrets(message),
    remediation: redactSecrets(remediation),
  };
}

function finalizeReport(
  projectDir: string,
  checks: ValidateCheck[],
): ValidateReport {
  const hasFail = checks.some((check) => check.status === "FAIL");
  const hasWarn = checks.some((check) => check.status === "WARN");
  const result = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  return { result, projectDir, checks };
}
