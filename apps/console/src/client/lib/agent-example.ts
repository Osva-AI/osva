export const ECHO_AGENT_KEY = "echo-input-agent";
export const ECHO_AGENT_NAME = "Echo Input Agent";
export const ECHO_AGENT_ENTRYPOINT = "echo-input-agent.ts";
export const ECHO_AGENT_FIXTURE_PATH =
  "adapters/runtime-typescript/test/fixtures/echo-input-agent.ts";
export const ECHO_AGENT_INPUT_EXAMPLE = { prompt: "hello" } as const;

/**
 * The adapters/runtime-typescript test echo-agent.ts fixture echoes process
 * environment values. Do not use it for Console first-run inspection.
 */
export const TEST_ECHO_AGENT_FIXTURE_PATH =
  "adapters/runtime-typescript/test/fixtures/echo-agent.ts";

/**
 * Integrity is operator-computed from the trusted entrypoint bytes.
 * This placeholder is intentionally not a valid sha256 digest so the
 * Console never pretends a hash was verified.
 */
export const ECHO_AGENT_INTEGRITY_PLACEHOLDER =
  "sha256:<hex-digest-of-echo-input-agent.ts>";

export function echoAgentManifestTemplate(options?: {
  readonly key?: string;
  readonly name?: string;
}): Record<string, unknown> {
  return {
    schemaVersion: "1",
    key: options?.key ?? ECHO_AGENT_KEY,
    name: options?.name ?? ECHO_AGENT_NAME,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: ECHO_AGENT_ENTRYPOINT,
      integrity: ECHO_AGENT_INTEGRITY_PLACEHOLDER,
    },
    input: {
      schema: {
        type: "object",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          echoed: {},
        },
      },
    },
    execution: { timeoutMs: 8000, maxAttempts: 1 },
    capabilities: { model: false, tools: [] },
  };
}

export function echoAgentManifestJson(options?: {
  readonly key?: string;
  readonly name?: string;
}): string {
  return JSON.stringify(echoAgentManifestTemplate(options), null, 2);
}

export const ECHO_AGENT_SETUP_COMMANDS = [
  "mkdir -p trusted-runtime",
  `cp ${ECHO_AGENT_FIXTURE_PATH} trusted-runtime/${ECHO_AGENT_ENTRYPOINT}`,
  "export OSVA_TRUSTED_RUNTIME_ROOT=./trusted-runtime",
  `node -e "const fs=require('node:fs'); const c=require('node:crypto'); const b=fs.readFileSync('trusted-runtime/${ECHO_AGENT_ENTRYPOINT}'); console.log('sha256:'+c.createHash('sha256').update(b).digest('hex'))"`,
] as const;
