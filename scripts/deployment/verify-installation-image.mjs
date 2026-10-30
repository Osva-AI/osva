#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDockerCapture } from "./docker-cli.mjs";
import { verifyRuntimeImageContents } from "./verify-runtime-image.mjs";

const PROCESS_CHECKS = [
  { process: "web", path: "/app/apps/web/dist/main.js" },
  { process: "worker", path: "/app/apps/worker/dist/main.js" },
  { process: "scheduler", path: "/app/apps/scheduler/dist/main.js" },
  {
    process: "workflow-orchestrator",
    path: "/app/apps/workflow-orchestrator/dist/main.js",
  },
  {
    process: "knowledge-worker",
    path: "/app/apps/knowledge-worker/dist/main.js",
  },
  { process: "console", path: "/app/apps/console/dist/server/main.js" },
  { process: "migrate", path: "/app/packages/db/dist/migrate-cli.js" },
  { process: "bootstrap", path: "/app/packages/db/dist/bootstrap-cli.js" },
  {
    process: "identity-bootstrap",
    path: "/app/apps/identity/dist/bootstrap-cli.js",
  },
  {
    process: "identity-recover",
    path: "/app/apps/identity/dist/recover-cli.js",
  },
  {
    process: "installation-status",
    path: "/app/packages/db/dist/installation-status-cli.js",
  },
];

export function verifyInstallationImageContents(image) {
  verifyRuntimeImageContents(image);

  for (const check of PROCESS_CHECKS) {
    const command = `test -f ${check.path} && echo ok-${check.process}`;
    const output = runDockerCapture([
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-c",
      command,
    ]);
    if (!output.includes(`ok-${check.process}`)) {
      throw new Error(
        `Installation image missing ${check.process} artifact at ${check.path}.`,
      );
    }
  }

  const consoleClient = runDockerCapture([
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "test -f /app/apps/console/dist/client/index.html && echo console-client-ok",
  ]);
  if (!consoleClient.includes("console-client-ok")) {
    throw new Error("Installation image missing Console client assets.");
  }

  return "installation-image-ok";
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const image = process.env.OSVA_IMAGE ?? "osva/local-m16-2d:dev";
  console.log(verifyInstallationImageContents(image));
}
