#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LITELLM_PROXY_IMAGE,
  LITELLM_PROXY_IMAGE_DIGEST,
} from "./constants.mjs";
import { dockerPreflight, findDockerBin, pullImage } from "./lib/docker.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:litellm [--preflight-only] [--skip-pull]

Live LiteLLM proxy acceptance (optional; not default CI).
Uses disposable Docker LiteLLM + in-process fake OpenAI upstream.
`);
}

function parseArgs(argv) {
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    preflightOnly: argv.includes("--preflight-only"),
    skipPull: argv.includes("--skip-pull"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  process.chdir(REPO_ROOT);
  const preflight = dockerPreflight();
  if (preflight.status !== 0) {
    process.exit(preflight.status ?? 1);
  }

  const dockerBin = await findDockerBin();
  if (!dockerBin) {
    console.error("Docker CLI not found");
    process.exit(1);
  }

  if (!options.skipPull) {
    await pullImage(dockerBin, LITELLM_PROXY_IMAGE);
  }

  if (options.preflightOnly) {
    console.log(
      JSON.stringify({
        status: "PREFLIGHT_OK",
        image: LITELLM_PROXY_IMAGE,
        digest: LITELLM_PROXY_IMAGE_DIGEST,
      }),
    );
    return;
  }

  const started = performance.now();
  const vitest = spawnSync(
    "pnpm",
    [
      "--filter",
      "@osva/worker",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/litellm-live-proxy.integration.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        OSVA_LITELLM_LIVE_ACCEPTANCE: "1",
      },
    },
  );
  const elapsedMs = Math.round(performance.now() - started);
  console.log(
    JSON.stringify({
      profile: "litellm-live-proxy",
      image: LITELLM_PROXY_IMAGE,
      digest: LITELLM_PROXY_IMAGE_DIGEST,
      elapsedMs,
      vitestExitCode: vitest.status ?? 1,
    }),
  );
  process.exit(vitest.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
