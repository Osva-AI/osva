import { writeStdout } from "../stdout.js";
import { formatDoctorHuman, formatDoctorJson } from "./format.js";
import { readDoctorEnv } from "./read-env.js";
import { doctorExitCode, runDoctorPipeline } from "./run-doctor.js";
import type { DoctorProbeOptions } from "./types.js";

export type { DoctorCheck, DoctorReport } from "./types.js";
export {
  doctorExitCode,
  runDoctorPipeline,
  REQUIRED_NODE_MAJOR,
  DEFAULT_PROBE_TIMEOUT_MS,
} from "./run-doctor.js";
export { redactSecrets } from "./redact.js";
export { readDoctorEnv } from "./read-env.js";

export async function runDoctorCommand(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv = process.env,
  options: DoctorProbeOptions = {},
): Promise<number> {
  const env = readDoctorEnv(flags, processEnv);
  const report = await runDoctorPipeline(env, options);
  const json = flags.json === true;
  await writeStdout(
    json ? formatDoctorJson(report) : formatDoctorHuman(report),
  );
  return doctorExitCode(report);
}
