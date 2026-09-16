import fs from "node:fs/promises";
import path from "node:path";

/**
 * Probes accidental filesystem write. Denied access is defense-in-depth for
 * trusted code, not a claim that hostile JavaScript cannot escape.
 */
export async function run(): Promise<{
  readonly wrote: boolean;
  readonly code: string | null;
}> {
  try {
    await fs.writeFile(path.join(process.cwd(), "escape.txt"), "no");
    return { wrote: true, code: null };
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : "unknown";
    return { wrote: false, code };
  }
}
