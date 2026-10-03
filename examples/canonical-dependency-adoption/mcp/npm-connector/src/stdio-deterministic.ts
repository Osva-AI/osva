import { serveStdio } from "@osva-ai/connector-sdk";

import { createCanonicalNpmResearchConnector } from "./connector.js";
import { createDeterministicNpmFetch } from "./deterministic-npm-fetch.js";
import { createNpmClient } from "./npm-client.js";

const connector = createCanonicalNpmResearchConnector({
  client: createNpmClient({ fetch: createDeterministicNpmFetch() }),
});

await serveStdio(connector);
