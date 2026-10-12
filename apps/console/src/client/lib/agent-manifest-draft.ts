import {
  AGENT_CONTAINER_PROTOCOL_VERSION,
  AGENT_REMOTE_HTTP_PROTOCOL_VERSION,
  AGENT_RUNTIME_TYPES,
  isSha256IntegrityDigest,
  type AgentRuntimeType,
} from "@osva-ai/contracts";

import {
  ECHO_AGENT_ENTRYPOINT,
  ECHO_AGENT_INTEGRITY_PLACEHOLDER,
  echoAgentManifestTemplate,
} from "./agent-example";
import { parseWorkflowRunInputJson } from "./workflow-run-input";

export const GUIDED_RUNTIME_TYPES = AGENT_RUNTIME_TYPES;

export interface GuidedManifestFields {
  readonly key: string;
  readonly name: string;
  readonly runtimeType: AgentRuntimeType;
  readonly entrypoint: string;
  readonly integrity: string;
  readonly remoteEndpoint: string;
  readonly containerImage: string;
  readonly packageKey: string;
  readonly timeoutMs: string;
}

export function defaultGuidedManifestFields(options?: {
  readonly key?: string;
  readonly name?: string;
}): GuidedManifestFields {
  const template = echoAgentManifestTemplate({
    key: options?.key,
    name: options?.name,
  });
  return extractGuidedManifestFields(template);
}

export function asManifestRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : echoAgentManifestTemplate();
}

export function extractGuidedManifestFields(
  manifest: unknown,
): GuidedManifestFields {
  const record = asManifestRecord(manifest);
  const runtime = isRecord(record.runtime) ? record.runtime : {};
  const execution = isRecord(record.execution) ? record.execution : {};
  const runtimeType = isRuntimeType(runtime.type)
    ? runtime.type
    : "TRUSTED_TYPESCRIPT";
  return {
    key: stringField(record.key, "echo-input-agent"),
    name: stringField(record.name, "Echo Input Agent"),
    runtimeType,
    entrypoint: stringField(runtime.entrypoint, ECHO_AGENT_ENTRYPOINT),
    integrity: stringField(runtime.integrity, ECHO_AGENT_INTEGRITY_PLACEHOLDER),
    remoteEndpoint: stringField(
      runtime.endpoint,
      "http://127.0.0.1:8787/execute",
    ),
    containerImage: stringField(runtime.image, ""),
    packageKey: stringField(
      runtime.key,
      stringField(record.key, "example-agent"),
    ),
    timeoutMs: stringField(execution.timeoutMs, "8000"),
  };
}

export function applyGuidedManifestFields(
  currentText: string,
  fields: GuidedManifestFields,
): string {
  const parsed = parseWorkflowRunInputJson(currentText);
  const base = parsed.ok
    ? { ...asManifestRecord(parsed.value) }
    : echoAgentManifestTemplate({ key: fields.key, name: fields.name });
  const timeoutMs = Number.parseInt(fields.timeoutMs, 10);
  const execution = isRecord(base.execution) ? { ...base.execution } : {};
  return JSON.stringify(
    {
      ...base,
      schemaVersion: "1",
      key: fields.key.trim() || "echo-input-agent",
      name: fields.name.trim() || "Echo Input Agent",
      runtime: runtimeFromFields(fields),
      execution: {
        ...execution,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000,
        maxAttempts:
          typeof execution.maxAttempts === "number" ? execution.maxAttempts : 1,
      },
    },
    null,
    2,
  );
}

export function describeManifestSubmitBlocker(
  manifestText: string,
): string | undefined {
  const parsed = parseWorkflowRunInputJson(manifestText);
  if (!parsed.ok) {
    return parsed.message;
  }

  const record = asManifestRecord(parsed.value);
  const runtime = isRecord(record.runtime) ? record.runtime : {};
  if (runtime.type === "TRUSTED_TYPESCRIPT") {
    if (
      typeof runtime.integrity !== "string" ||
      !isSha256IntegrityDigest(runtime.integrity)
    ) {
      return "runtime.integrity must be sha256:<64 hex chars> of the trusted entrypoint bytes. Replace the placeholder after copying the fixture under OSVA_TRUSTED_RUNTIME_ROOT.";
    }
    if (
      typeof runtime.entrypoint !== "string" ||
      runtime.entrypoint.trim().length === 0
    ) {
      return "runtime.entrypoint is required for TRUSTED_TYPESCRIPT.";
    }
  }

  if (runtime.type === "REMOTE_HTTP") {
    if (
      typeof runtime.endpoint !== "string" ||
      runtime.endpoint.trim().length === 0
    ) {
      return "runtime.endpoint is required for REMOTE_HTTP.";
    }
  }

  if (runtime.type === "CONTAINER") {
    if (
      typeof runtime.image !== "string" ||
      runtime.image.trim().length === 0
    ) {
      return "runtime.image is required for CONTAINER and must be digest-pinned.";
    }
  }

  if (runtime.type === "BUILTIN_PACKAGE") {
    if (typeof runtime.key !== "string" || runtime.key.trim().length === 0) {
      return "runtime.key is required for BUILTIN_PACKAGE.";
    }
  }

  return undefined;
}

export function describeBuiltinPackageWarning(
  manifestText: string,
): string | undefined {
  const parsed = parseWorkflowRunInputJson(manifestText);
  if (!parsed.ok) {
    return undefined;
  }
  const record = asManifestRecord(parsed.value);
  const runtime = isRecord(record.runtime) ? record.runtime : {};
  if (runtime.type !== "BUILTIN_PACKAGE") {
    return undefined;
  }
  return "BUILTIN_PACKAGE is for in-process test adapters. Production workers typically have no executor for this type; a launched Run will fail at execution with UNSUPPORTED_RUNTIME.";
}

export function describeRegistryWriteFailure(
  status: number,
): string | undefined {
  switch (status) {
    case 400:
      return "The control plane rejected this request as invalid. Extra fields such as workspaceId are not allowed.";
    case 403:
      return "This API key cannot write Agents (EDITOR or ADMIN required).";
    case 404:
      return "The Agent was not found in the authenticated workspace.";
    case 409:
      return "An Agent with this key already exists in the workspace, or the request conflicted with an existing row.";
    default:
      return undefined;
  }
}

function runtimeFromFields(
  fields: GuidedManifestFields,
): Record<string, unknown> {
  switch (fields.runtimeType) {
    case "TRUSTED_TYPESCRIPT":
      return {
        type: "TRUSTED_TYPESCRIPT",
        entrypoint: fields.entrypoint.trim() || ECHO_AGENT_ENTRYPOINT,
        integrity: fields.integrity.trim() || ECHO_AGENT_INTEGRITY_PLACEHOLDER,
      };
    case "REMOTE_HTTP":
      return {
        type: "REMOTE_HTTP",
        protocolVersion: AGENT_REMOTE_HTTP_PROTOCOL_VERSION,
        endpoint: fields.remoteEndpoint.trim(),
      };
    case "CONTAINER":
      return {
        type: "CONTAINER",
        protocolVersion: AGENT_CONTAINER_PROTOCOL_VERSION,
        image: fields.containerImage.trim(),
      };
    case "BUILTIN_PACKAGE":
      return {
        type: "BUILTIN_PACKAGE",
        key: fields.packageKey.trim() || fields.key.trim() || "example-agent",
      };
  }
}

function isRuntimeType(value: unknown): value is AgentRuntimeType {
  return (
    typeof value === "string" &&
    (AGENT_RUNTIME_TYPES as readonly string[]).includes(value)
  );
}

function stringField(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
