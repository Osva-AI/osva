import path from "node:path";
import { fileURLToPath } from "node:url";

const setupModuleDir = path.dirname(fileURLToPath(import.meta.url));

/** Bundled registry-only Compose distribution shipped with the CLI package. */
export function resolveComposeInstallTemplateRoot(): string {
  return path.resolve(setupModuleDir, "../../templates/compose-install");
}
