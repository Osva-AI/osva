import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function run(command, args) {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.exitCode = code;
    }
  });
  return child;
}

const server = run("node", ["--watch", "dist/server/main.js"]);
const tsc = run("pnpm", [
  "exec",
  "tsc",
  "-p",
  "tsconfig.server.json",
  "--watch",
  "--preserveWatchOutput",
]);

setTimeout(() => {
  run("pnpm", ["exec", "vite"]);
}, 1500);

function shutdown() {
  server.kill("SIGTERM");
  tsc.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
