#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDockerCapture } from "./docker-cli.mjs";

const FORBIDDEN_PACKAGES = [
  "typescript",
  "turbo",
  "vitest",
  "eslint",
  "prettier",
];

export function verifyRuntimeImageContents(image) {
  const checks = FORBIDDEN_PACKAGES.map(
    (pkg) => `test ! -e node_modules/${pkg}`,
  );
  checks.push("test -d /var/lib/osva/trusted-runtime");
  const command = `${checks.join(" && ")} && echo runtime-image-deps-ok`;

  const output = runDockerCapture([
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    command,
  ]);
  if (!output.includes("runtime-image-deps-ok")) {
    throw new Error("Runtime image dependency verification failed.");
  }
  return output.trim();
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const image = process.env.OSVA_IMAGE ?? "osva:smoke";
  console.log(verifyRuntimeImageContents(image));
}
