export {
  agentArtifactPath,
  agentSourcePath,
  contractsDir,
  HELLO_AGENT_ENTRYPOINT,
  packageRootDir,
  requiredAgentBuildArtifacts,
  resolvePackageRoot,
} from "./paths.js";

export const HELLO_AGENT_KEY = "hello-agent";
export const HELLO_AGENT_NAME = "Hello Agent";

export const HELLO_DEFAULT_INPUT = { message: "Hello OSVA" } as const;
export const HELLO_EXPECTED_OUTPUT = { echoed: "Hello OSVA" } as const;

export const HELLO_STATE_SCHEMA_VERSION = "1" as const;
