import { writeStdout } from "../stdout.js";
import { runInit } from "./run-init.js";

export type { InitResult } from "./types.js";
export { runInit } from "./run-init.js";
export { validateProjectName } from "./validate-project-name.js";
export { resolveInitTargetDir } from "./resolve-target.js";
export { resolveAgentTemplateRoot } from "./template-root.js";

export async function runInitCommand(
  command: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
  cwd: string = process.cwd(),
): Promise<number> {
  void flags.yes;
  const projectName = command[1];
  const result = await runInit({ projectName, cwd });
  const json = flags.json === true;

  if (!result.ok) {
    if (json) {
      await writeStdout(
        `${JSON.stringify({ ok: false, error: result.error })}\n`,
      );
    } else {
      process.stderr.write(`${result.error}\n`);
    }
    return 1;
  }

  if (json) {
    await writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  await writeStdout(
    [
      `Created OSVA agent project "${result.projectName}".`,
      "",
      "Next steps:",
      `  cd ${result.projectName}`,
      "  npm install",
      "  npm run build",
      "  npm run manifest",
      "",
      "  osva deploy",
      '  osva run --wait --input \'{"message":"Hello OSVA"}\'',
      "",
    ].join("\n"),
  );
  return 0;
}
