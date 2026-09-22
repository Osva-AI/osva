import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

export const CLI_VERSION = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  .version as string;
