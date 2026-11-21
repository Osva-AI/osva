import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { startFakeOpenAIResponsesServer } = await import(
  pathToFileURL(
    path.resolve(
      import.meta.dirname,
      "../../../../adapters/model-openai/test/fake-openai-server.ts",
    ),
  ).href
);

const fake = await startFakeOpenAIResponsesServer();
const port = new URL(fake.origin).port;
const template = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../fixtures/litellm-acceptance-config.yaml",
  ),
  "utf8",
);
const configPath = path.join(os.tmpdir(), "litellm-probe.yaml");
fs.writeFileSync(
  configPath,
  template.replaceAll(
    "__FAKE_UPSTREAM_V1__",
    `http://host.docker.internal:${String(port)}/v1`,
  ),
);

try {
  execFileSync("docker", ["rm", "-f", "osva-litellm-probe"], {
    stdio: "ignore",
  });
} catch {
  // ignore
}

execFileSync(
  "docker",
  [
    "run",
    "-d",
    "--name",
    "osva-litellm-probe",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1:14010:4000",
    "-e",
    "LITELLM_MASTER_KEY=sk-osva-litellm-acceptance",
    "-v",
    `${configPath.replaceAll("\\", "/")}:/app/config.yaml:ro`,
    "docker.litellm.ai/berriai/litellm:main-v1.63.11-stable",
    "--config",
    "/app/config.yaml",
  ],
  { stdio: "inherit" },
);

for (let i = 0; i < 30; i += 1) {
  try {
    const health = await fetch("http://127.0.0.1:14010/health/liveliness");
    if (health.ok) {
      break;
    }
  } catch {
    // wait
  }
  await new Promise((r) => setTimeout(r, 2000));
}

const responses = await fetch("http://127.0.0.1:14010/v1/responses", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk-osva-litellm-acceptance",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "osva-litellm-primary",
    input: "hello",
  }),
});
console.log(
  "responses",
  responses.status,
  (await responses.text()).slice(0, 500),
);

const chat = await fetch("http://127.0.0.1:14010/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk-osva-litellm-acceptance",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "osva-litellm-primary",
    messages: [{ role: "user", content: "hello" }],
  }),
});
console.log("chat", chat.status, (await chat.text()).slice(0, 500));
console.log("fake requests", fake.requests.length);

await fake.close();
execFileSync("docker", ["rm", "-f", "osva-litellm-probe"], { stdio: "ignore" });
