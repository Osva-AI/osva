import path from "node:path";
import { fileURLToPath } from "node:url";

const initModuleDir = path.dirname(fileURLToPath(import.meta.url));

/** Bundled scaffold lives beside compiled `dist/` output. */
export function resolveAgentTemplateRoot(): string {
  return path.resolve(initModuleDir, "../../templates/agent-typescript");
}
