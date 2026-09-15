import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

export async function createTrustedRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "osva-trusted-runtime-"));
}

export async function installFixture(
  root: string,
  fixtureName: string,
  destName = fixtureName,
): Promise<string> {
  const dest = path.join(root, destName);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(path.join(fixtureDir, fixtureName), dest);
  return dest;
}
