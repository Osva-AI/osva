import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function readJson(relativePath) {
  const raw = await readFile(path.join(projectRoot, relativePath), "utf8");
  return JSON.parse(raw);
}

const project = await readJson("osva-agent.project.json");
const inputSchema = await readJson(project.contracts.input);
const outputSchema = await readJson(project.contracts.output);
const entrypoint = project.runtime.entrypoint;
const artifactPath = path.join(projectRoot, "dist", "agent", entrypoint);

let artifactBytes;
try {
  artifactBytes = await readFile(artifactPath);
} catch {
  process.stderr.write(
    `Build artifact not found at dist/agent/${entrypoint}. Run npm run build first.\n`,
  );
  process.exit(1);
}

const integrity = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;

const manifest = {
  schemaVersion: "1",
  key: project.key,
  name: project.name,
  runtime: {
    type: "TRUSTED_TYPESCRIPT",
    entrypoint,
    integrity,
  },
  input: { schema: inputSchema },
  output: { schema: outputSchema },
  execution: project.execution,
  capabilities: project.capabilities,
};

await writeFile(
  path.join(projectRoot, "osva.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
