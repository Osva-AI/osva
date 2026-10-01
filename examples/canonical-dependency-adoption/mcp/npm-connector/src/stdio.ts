import { serveStdio } from "@osva-ai/connector-sdk";

import { canonicalNpmResearchConnector } from "./connector.js";

await serveStdio(canonicalNpmResearchConnector);
