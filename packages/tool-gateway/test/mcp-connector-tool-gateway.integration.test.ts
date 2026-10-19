import { registerMcpConnectorCompatibilitySuite } from "./fixtures/mcp-connector-compatibility.harness.js";
import { githubConnectorCompatibilityCase } from "./connector-compatibility/github.connector-compatibility.case.js";

registerMcpConnectorCompatibilitySuite(githubConnectorCompatibilityCase);
