import path from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const normalizedDemoDir = demoDir.replace(/\\/g, "/");
export const packageRoot = normalizedDemoDir.includes("/dist/demo")
  ? path.resolve(demoDir, "../..")
  : path.resolve(demoDir, "..");

export function demoPublicDir(): string {
  return path.join(packageRoot, "demo", "public");
}
