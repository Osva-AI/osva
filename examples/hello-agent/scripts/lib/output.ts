import type { HelloTimingReport } from "./timing.js";

export function printFailure(message: string): void {
  console.error("");
  console.error("Hello Agent golden path failed.");
  console.error(message);
}

export function printSuccess(input: {
  readonly runId: string;
  readonly runAttemptId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly status: string;
  readonly output: unknown;
  readonly reusedAgentVersion: boolean;
  readonly deployTarget: string;
  readonly integrity: string;
  readonly timing: HelloTimingReport;
}): void {
  console.log("OSVA Hello Agent — golden path");
  console.log("");
  console.log(
    `Agent:         ${input.agentId} (${input.reusedAgentVersion ? "reused version" : "new version"})`,
  );
  console.log(`AgentVersion:  ${input.agentVersionId}`);
  console.log(`Run:           ${input.runId}`);
  console.log(`RunAttempt:    ${input.runAttemptId}`);
  console.log(`Status:        ${input.status}`);
  console.log(`Deploy target: ${input.deployTarget}`);
  console.log(`Integrity:     ${input.integrity}`);
  console.log("");
  console.log("Output:");
  console.log(JSON.stringify(input.output, null, 2));
  console.log("");
  console.log("Timing (ms, monotonic):");
  console.log(JSON.stringify(input.timing, null, 2));
}
