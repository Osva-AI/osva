import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const INSTALLATION_MARKER_RELATIVE = path.join(
  ".osva",
  "installation.json",
);

export interface InstallationMarker {
  readonly schemaVersion: 1;
  readonly platformVersion: string;
  readonly imageRef: string;
  readonly cliVersion: string;
  readonly installDir: string;
  readonly composeProjectName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type InstallDirectoryKind =
  "missing" | "empty" | "osva_installation" | "foreign";

export interface InstallDirectoryAssessment {
  readonly kind: InstallDirectoryKind;
  readonly marker: InstallationMarker | undefined;
  readonly foreignEntries: readonly string[];
}

export async function assessInstallDirectory(
  installDir: string,
): Promise<InstallDirectoryAssessment> {
  let entries: string[];
  try {
    entries = await readdir(installDir);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { kind: "missing", marker: undefined, foreignEntries: [] };
    }
    throw error;
  }
  if (entries.length === 0) {
    return { kind: "empty", marker: undefined, foreignEntries: [] };
  }

  const markerPath = path.join(installDir, INSTALLATION_MARKER_RELATIVE);
  const marker = await readInstallationMarker(markerPath);
  const recognized = new Set([
    ".osva",
    "compose.yml",
    ".env",
    ".env.example",
    "README.md",
    ".acceptance-bootstrap-key",
    ".acceptance-setup-token",
  ]);
  const foreignEntries = entries.filter((entry) => !recognized.has(entry));

  if (marker !== undefined) {
    return { kind: "osva_installation", marker, foreignEntries };
  }
  if (foreignEntries.length > 0) {
    return { kind: "foreign", marker: undefined, foreignEntries };
  }
  if (entries.every((entry) => recognized.has(entry))) {
    return { kind: "empty", marker: undefined, foreignEntries: [] };
  }
  return { kind: "foreign", marker: undefined, foreignEntries: entries };
}

export async function readInstallationMarker(
  markerPath: string,
): Promise<InstallationMarker | undefined> {
  try {
    const raw = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as InstallationMarker;
    if (parsed.schemaVersion !== 1) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    return undefined;
  }
}

export function renderInstallationMarker(input: {
  readonly platformVersion: string;
  readonly imageRef: string;
  readonly cliVersion: string;
  readonly installDir: string;
  readonly composeProjectName: string;
  readonly existing?: InstallationMarker;
}): InstallationMarker {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    platformVersion: input.platformVersion,
    imageRef: input.imageRef,
    cliVersion: input.cliVersion,
    installDir: input.installDir,
    composeProjectName: input.composeProjectName,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}
