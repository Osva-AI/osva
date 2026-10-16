import { writeStdout } from "../stdout.js";
import { validateExitCode } from "./exit-code.js";
import { formatValidateHuman, formatValidateJson } from "./format.js";
import { resolveValidateProjectDir } from "./resolve-project-dir.js";
import { runValidatePipeline } from "./run-validate.js";
import type { ValidateReport } from "./types.js";

export type { ValidateCheck, ValidateReport } from "./types.js";
export { validateExitCode } from "./exit-code.js";
export { runValidatePipeline } from "./run-validate.js";
export { resolveValidateProjectDir } from "./resolve-project-dir.js";

export async function runValidateCommand(
  flags: Readonly<Record<string, string | boolean>>,
  cwd: string = process.cwd(),
): Promise<number> {
  const json = flags.json === true;
  const resolved = await resolveValidateProjectDir({ cwd, flags });

  const report: ValidateReport = resolved.ok
    ? await runValidatePipeline(resolved.projectDir)
    : {
        result: "fail",
        projectDir: resolved.projectDir,
        checks: [
          {
            id: "project_directory",
            status: "FAIL",
            message: resolved.error,
            remediation:
              "Use --project to point at an osva init scaffold directory.",
          },
        ],
      };

  await writeStdout(
    json ? formatValidateJson(report) : formatValidateHuman(report),
  );
  return validateExitCode(report);
}
