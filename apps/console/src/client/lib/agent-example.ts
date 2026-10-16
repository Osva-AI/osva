export const HELLO_AGENT_KEY = "hello-agent";
export const HELLO_AGENT_NAME = "Hello Agent";
export const HELLO_AGENT_ENTRYPOINT = "hello-agent.ts";
export const HELLO_AGENT_SOURCE_PATH =
  "examples/hello-agent/agent/hello-agent.ts";
export const HELLO_AGENT_INPUT_EXAMPLE = { message: "Hello OSVA" } as const;
export const HELLO_AGENT_OUTPUT_EXAMPLE = { echoed: "Hello OSVA" } as const;
export const HELLO_AGENT_GOLDEN_PATH_COMMAND = "pnpm example:hello";

/** @deprecated Use HELLO_AGENT_* constants; kept for transitional imports. */
export const ECHO_AGENT_KEY = HELLO_AGENT_KEY;
/** @deprecated Use HELLO_AGENT_* constants. */
export const ECHO_AGENT_NAME = HELLO_AGENT_NAME;
/** @deprecated Use HELLO_AGENT_* constants. */
export const ECHO_AGENT_ENTRYPOINT = HELLO_AGENT_ENTRYPOINT;
/** @deprecated Use HELLO_AGENT_SOURCE_PATH. */
export const ECHO_AGENT_FIXTURE_PATH = HELLO_AGENT_SOURCE_PATH;
/** @deprecated Use HELLO_AGENT_INPUT_EXAMPLE. */
export const ECHO_AGENT_INPUT_EXAMPLE = HELLO_AGENT_INPUT_EXAMPLE;

/**
 * Integrity is operator-computed from the trusted entrypoint bytes.
 * This placeholder is intentionally not a valid sha256 digest so the
 * Console never pretends a hash was verified.
 */
export const HELLO_AGENT_INTEGRITY_PLACEHOLDER =
  "sha256:<hex-digest-of-hello-agent.ts>";
/** @deprecated Use HELLO_AGENT_INTEGRITY_PLACEHOLDER. */
export const ECHO_AGENT_INTEGRITY_PLACEHOLDER =
  HELLO_AGENT_INTEGRITY_PLACEHOLDER;

/**
 * The adapters/runtime-typescript test echo-agent.ts fixture echoes process
 * environment values. Do not use it for Console first-run inspection.
 */
export const TEST_ECHO_AGENT_FIXTURE_PATH =
  "adapters/runtime-typescript/test/fixtures/echo-agent.ts";

export function helloAgentManifestTemplate(options?: {
  readonly key?: string;
  readonly name?: string;
}): Record<string, unknown> {
  return {
    schemaVersion: "1",
    key: options?.key ?? HELLO_AGENT_KEY,
    name: options?.name ?? HELLO_AGENT_NAME,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: HELLO_AGENT_ENTRYPOINT,
      integrity: HELLO_AGENT_INTEGRITY_PLACEHOLDER,
    },
    input: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: {
          message: { type: "string", minLength: 1 },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["echoed"],
        properties: {
          echoed: { type: "string", minLength: 1 },
        },
      },
    },
    execution: { timeoutMs: 8000, maxAttempts: 1 },
    capabilities: { model: false, tools: [] },
  };
}

/** @deprecated Use helloAgentManifestTemplate. */
export function echoAgentManifestTemplate(options?: {
  readonly key?: string;
  readonly name?: string;
}): Record<string, unknown> {
  return helloAgentManifestTemplate(options);
}

export function helloAgentManifestJson(options?: {
  readonly key?: string;
  readonly name?: string;
}): string {
  return JSON.stringify(helloAgentManifestTemplate(options), null, 2);
}

/** @deprecated Use helloAgentManifestJson. */
export function echoAgentManifestJson(options?: {
  readonly key?: string;
  readonly name?: string;
}): string {
  return helloAgentManifestJson(options);
}

export const HELLO_AGENT_SETUP_COMMANDS = [
  "# Recommended: golden path installs runtime + registers + runs",
  HELLO_AGENT_GOLDEN_PATH_COMMAND,
  "",
  "# Manual host install (PowerShell):",
  "New-Item -ItemType Directory -Force -Path trusted-runtime",
  `Copy-Item ${HELLO_AGENT_SOURCE_PATH} trusted-runtime/${HELLO_AGENT_ENTRYPOINT}`,
  "$env:OSVA_TRUSTED_RUNTIME_ROOT = (Resolve-Path trusted-runtime).Path",
  `node -e "const fs=require('node:fs'); const c=require('node:crypto'); const b=fs.readFileSync('trusted-runtime/${HELLO_AGENT_ENTRYPOINT}'); console.log('sha256:'+c.createHash('sha256').update(b).digest('hex'))"`,
] as const;

/** @deprecated Use HELLO_AGENT_SETUP_COMMANDS. */
export const ECHO_AGENT_SETUP_COMMANDS = HELLO_AGENT_SETUP_COMMANDS;
