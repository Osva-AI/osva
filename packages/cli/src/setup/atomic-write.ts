import { chmod, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomic(
  targetPath: string,
  contents: string,
  options?: { readonly restrictPermissions?: boolean },
): Promise<void> {
  const directory = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  const tempPath = path.join(
    directory,
    `.${baseName}.${String(process.pid)}.tmp`,
  );
  await writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        await writeFile(tempPath, contents, { encoding: "utf8" });
        return;
      }
      throw error;
    },
  );
  await rename(tempPath, targetPath);
  if (options?.restrictPermissions === true && process.platform !== "win32") {
    await chmod(targetPath, 0o600);
  }
}
