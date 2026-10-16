import { redactSecrets } from "../doctor/redact.js";

export interface DeployResultPayload {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly deployTarget: string;
  readonly integrity: string;
  readonly reusedAgentVersion: boolean;
  readonly workspaceId: string;
}

export interface RunResultPayload {
  readonly runId: string;
  readonly runAttemptId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly status: string;
  readonly runAttemptStatus: string;
  readonly output: unknown;
}

export interface StatusResultPayload {
  readonly deployment: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly agentKey: string;
    readonly deployTarget: string;
    readonly integrity: string;
    readonly updatedAt: string;
    readonly lastRunId?: string;
    readonly lastRunAttemptId?: string;
  } | null;
  readonly lastRun?: {
    readonly id: string;
    readonly status: string;
    readonly runAttemptId?: string;
    readonly runAttemptStatus?: string;
  };
}

export function formatDeployHuman(payload: DeployResultPayload): string {
  const lines = [
    "OSVA Deploy",
    "",
    `Agent ID:         ${payload.agentId}`,
    `AgentVersion ID:  ${payload.agentVersionId}`,
    `Workspace:        ${payload.workspaceId}`,
    `Deploy target:    ${payload.deployTarget}`,
    `Integrity:        ${payload.integrity}`,
    `AgentVersion:     ${payload.reusedAgentVersion ? "reused" : "created"}`,
    "",
  ];
  return `${lines.map(redactSecrets).join("\n")}\n`;
}

export function formatDeployJson(payload: DeployResultPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function formatRunHuman(payload: RunResultPayload): string {
  const lines = [
    "OSVA Run",
    "",
    `Run ID:           ${payload.runId}`,
    `RunAttempt ID:    ${payload.runAttemptId}`,
    `Status:           ${payload.status}`,
    `RunAttempt:       ${payload.runAttemptStatus}`,
    "",
    "Output:",
    JSON.stringify(payload.output, null, 2),
    "",
  ];
  return `${lines.map(redactSecrets).join("\n")}\n`;
}

export function formatRunJson(payload: RunResultPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function formatStatusHuman(payload: StatusResultPayload): string {
  const lines = ["OSVA Status", ""];
  if (payload.deployment === null) {
    lines.push("No local deployment state. Run osva deploy first.");
  } else {
    lines.push(`Agent key:        ${payload.deployment.agentKey}`);
    lines.push(`Agent ID:         ${payload.deployment.agentId}`);
    lines.push(`AgentVersion ID:  ${payload.deployment.agentVersionId}`);
    lines.push(`Deploy target:    ${payload.deployment.deployTarget}`);
    lines.push(`Integrity:        ${payload.deployment.integrity}`);
    lines.push(`Updated:          ${payload.deployment.updatedAt}`);
    if (payload.deployment.lastRunId !== undefined) {
      lines.push(`Last run ID:      ${payload.deployment.lastRunId}`);
    }
  }
  if (payload.lastRun !== undefined) {
    lines.push("");
    lines.push(
      `Latest run:       ${payload.lastRun.id} (${payload.lastRun.status})`,
    );
    if (payload.lastRun.runAttemptStatus !== undefined) {
      lines.push(`Latest attempt:   ${payload.lastRun.runAttemptStatus}`);
    }
  }
  lines.push("");
  return `${lines.map(redactSecrets).join("\n")}\n`;
}

export function formatStatusJson(payload: StatusResultPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
