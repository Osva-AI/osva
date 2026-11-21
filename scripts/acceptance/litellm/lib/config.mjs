import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/litellm-acceptance-config.yaml",
);

export async function writeRuntimeLitellmConfig(upstreamBaseWithV1) {
  const template = await fs.readFile(FIXTURE_PATH, "utf8");
  const rendered = template.replaceAll(
    "__FAKE_UPSTREAM_V1__",
    upstreamBaseWithV1.replace(/\/$/, ""),
  );
  const configPath = path.join(
    process.cwd(),
    ".acceptance-litellm-config.generated.yaml",
  );
  await fs.writeFile(configPath, rendered, "utf8");
  return configPath;
}
