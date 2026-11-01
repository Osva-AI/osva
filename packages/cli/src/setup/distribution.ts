import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveComposeInstallTemplateRoot } from "./compose-template-root.js";

export interface ComposeDistributionManifest {
  readonly distributionSchemaVersion: number;
  readonly platformVersion: string;
  readonly imageRef: string;
}

export interface ComposeDistribution {
  readonly manifest: ComposeDistributionManifest;
  readonly composeYaml: string;
  readonly remoteHttpDevComposeYaml: string;
  readonly templateRoot: string;
}

export async function loadComposeDistribution(): Promise<ComposeDistribution> {
  const templateRoot = resolveComposeInstallTemplateRoot();
  const manifestPath = path.join(templateRoot, "distribution.json");
  const composePath = path.join(templateRoot, "compose.yml");
  const remoteHttpDevComposePath = path.join(
    templateRoot,
    "compose.remote-http-dev.yml",
  );
  const [manifestRaw, composeYaml, remoteHttpDevComposeYaml] =
    await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(composePath, "utf8"),
      readFile(remoteHttpDevComposePath, "utf8"),
    ]);
  const manifest = JSON.parse(manifestRaw) as ComposeDistributionManifest;
  assertDistributionManifest(manifest);
  assertRegistryOnlyCompose(composeYaml);
  assertRemoteHttpDevOverlay(remoteHttpDevComposeYaml);
  return { manifest, composeYaml, remoteHttpDevComposeYaml, templateRoot };
}

function assertDistributionManifest(
  manifest: ComposeDistributionManifest,
): void {
  if (manifest.distributionSchemaVersion !== 1) {
    throw new Error(
      `Unsupported compose distribution schema version ${String(manifest.distributionSchemaVersion)}.`,
    );
  }
  if (
    typeof manifest.platformVersion !== "string" ||
    manifest.platformVersion.length === 0
  ) {
    throw new Error(
      "Compose distribution manifest is missing platformVersion.",
    );
  }
  if (typeof manifest.imageRef !== "string" || manifest.imageRef.length === 0) {
    throw new Error("Compose distribution manifest is missing imageRef.");
  }
  assertPinnedImageRef(manifest.imageRef);
}

export function assertPinnedImageRef(imageRef: string): void {
  const trimmed = imageRef.trim();
  if (trimmed.length === 0) {
    throw new Error("OSVA image reference must not be empty.");
  }
  if (trimmed === "latest" || trimmed.endsWith(":latest")) {
    throw new Error("Refusing unversioned OSVA image tag for installation.");
  }
  const lastSegment = trimmed.split("/").at(-1) ?? trimmed;
  if (!lastSegment.includes(":")) {
    throw new Error(
      "Refusing OSVA image reference without an explicit version tag.",
    );
  }
  const tag = lastSegment.split(":").at(-1) ?? "";
  if (tag.length === 0) {
    throw new Error(
      "Refusing OSVA image reference without an explicit version tag.",
    );
  }
}

function assertRemoteHttpDevOverlay(composeYaml: string): void {
  if (!composeYaml.includes("OSVA_RUNTIME_CAPABILITY_SECRET")) {
    throw new Error(
      "Bundled remote-http-dev compose overlay is missing runtime capability wiring.",
    );
  }
  if (
    !composeYaml.includes("127.0.0.1:${OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT")
  ) {
    throw new Error(
      "Bundled remote-http-dev compose overlay must publish the capability port on loopback only.",
    );
  }
}

function assertRegistryOnlyCompose(composeYaml: string): void {
  if (/\n\s*build\s*:/.test(composeYaml)) {
    throw new Error(
      "Bundled installation compose must not contain image build contexts.",
    );
  }
  if (!composeYaml.includes("OSVA_IMAGE:?OSVA_IMAGE is required")) {
    throw new Error(
      "Bundled installation compose must require an explicit OSVA_IMAGE.",
    );
  }
}
