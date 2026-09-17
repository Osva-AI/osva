import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_PROTOCOL_FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../runtime-protocol/fixtures/v1",
);
