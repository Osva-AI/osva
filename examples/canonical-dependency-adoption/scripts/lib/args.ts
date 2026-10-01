import { randomUUID } from "node:crypto";

export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

export interface RunCliArgs {
  readonly packageName: string;
  readonly useCase: string;
  readonly constraints: readonly string[];
  readonly requestId: string;
}

export interface StatusCliArgs {
  readonly workflowRunId: string;
}

export interface ApproveCliArgs {
  readonly workflowRunId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly comment: string | undefined;
}

export interface EmitDeliveryEventCliArgs {
  readonly requestId: string;
  readonly workflowRunId: string | undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidRequestId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function generateRequestId(): string {
  return randomUUID();
}

export function buildWorkflowRunInput(input: {
  readonly requestId: string;
  readonly packageName: string;
  readonly useCase: string;
  readonly constraints: readonly string[];
}): {
  schemaVersion: "1";
  request: {
    requestId: string;
    packageName: string;
    useCase: string;
    constraints: string[];
  };
} {
  return {
    schemaVersion: "1",
    request: {
      requestId: input.requestId,
      packageName: input.packageName,
      useCase: input.useCase,
      constraints: [...input.constraints],
    },
  };
}

export function deliveryEventIdempotencyKey(requestId: string): string {
  return `canonical-demo:delivery:${requestId}`;
}

export function buildDeliveryEventRequest(requestId: string): {
  source: "canonical-demo";
  eventType: "report.delivery_requested";
  correlationKey: string;
  idempotencyKey: string;
  payload: { requestedBy: "canonical-demo-cli" };
} {
  return {
    source: "canonical-demo",
    eventType: "report.delivery_requested",
    correlationKey: requestId,
    idempotencyKey: deliveryEventIdempotencyKey(requestId),
    payload: {
      requestedBy: "canonical-demo-cli",
    },
  };
}

function takeValue(flag: string, argv: string[], index: number): string {
  const value = argv[index + 1]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ArgsError(`Missing value for ${flag}.`);
  }
  return value;
}

export function parseRunArgs(argv: readonly string[]): RunCliArgs {
  let packageName: string | undefined;
  let useCase: string | undefined;
  const constraints: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--package") {
      packageName = takeValue(token, argv as string[], index);
      index += 1;
      continue;
    }
    if (token === "--use-case") {
      useCase = takeValue(token, argv as string[], index);
      index += 1;
      continue;
    }
    if (token === "--constraint") {
      constraints.push(takeValue(token, argv as string[], index));
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new ArgsError(`Unknown option: ${token}`);
    }
    throw new ArgsError(`Unexpected argument: ${token}`);
  }

  if (packageName === undefined || packageName.length === 0) {
    throw new ArgsError("Missing required --package.");
  }
  if (useCase === undefined || useCase.length === 0) {
    throw new ArgsError("Missing required --use-case.");
  }

  return {
    packageName,
    useCase,
    constraints,
    requestId: generateRequestId(),
  };
}

export function parseStatusArgs(argv: readonly string[]): StatusCliArgs {
  let workflowRunId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--workflow-run") {
      workflowRunId = takeValue(token, argv as string[], index);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new ArgsError(`Unknown option: ${token}`);
    }
    if (workflowRunId !== undefined) {
      throw new ArgsError("Provide a single workflow run id.");
    }
    workflowRunId = token.trim();
  }

  if (workflowRunId === undefined || workflowRunId.length === 0) {
    throw new ArgsError(
      "Missing workflow run id. Usage: pnpm canonical:status <workflowRunId>",
    );
  }

  return { workflowRunId };
}

export function parseApproveArgs(argv: readonly string[]): ApproveCliArgs {
  let workflowRunId: string | undefined;
  let comment: string | undefined;
  let reject = false;
  let approveFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--comment") {
      comment = takeValue(token, argv as string[], index);
      index += 1;
      continue;
    }
    if (token === "--reject") {
      reject = true;
      continue;
    }
    if (token === "--approve") {
      approveFlag = true;
      continue;
    }
    if (token.startsWith("-")) {
      throw new ArgsError(`Unknown option: ${token}`);
    }
    if (workflowRunId !== undefined) {
      throw new ArgsError("Provide a single workflow run id.");
    }
    workflowRunId = token.trim();
  }

  if (workflowRunId === undefined || workflowRunId.length === 0) {
    throw new ArgsError(
      "Missing workflow run id. Usage: pnpm canonical:approve <workflowRunId>",
    );
  }
  if (reject && approveFlag) {
    throw new ArgsError("Use either --reject or --approve, not both.");
  }

  return {
    workflowRunId,
    decision: reject ? "REJECTED" : "APPROVED",
    comment,
  };
}

export function parseEmitDeliveryEventArgs(
  argv: readonly string[],
): EmitDeliveryEventCliArgs {
  let requestId: string | undefined;
  let workflowRunId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--workflow-run") {
      workflowRunId = takeValue(token, argv as string[], index);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new ArgsError(`Unknown option: ${token}`);
    }
    if (requestId !== undefined) {
      throw new ArgsError("Provide a single request id.");
    }
    requestId = token.trim();
  }

  if (
    requestId === undefined &&
    (workflowRunId === undefined || workflowRunId.length === 0)
  ) {
    throw new ArgsError(
      "Missing request id. Usage: pnpm canonical:emit-delivery-event <requestId>",
    );
  }

  return {
    requestId: requestId ?? "",
    workflowRunId,
  };
}

export function extractRequestIdFromWorkflowInput(
  input: unknown,
): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const request = (input as Record<string, unknown>).request;
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request)
  ) {
    return null;
  }
  const requestId = (request as Record<string, unknown>).requestId;
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return null;
  }
  return requestId.trim();
}
