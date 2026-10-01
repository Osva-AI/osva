import { serveStdio } from "@osva-ai/connector-sdk";

import { echoConnector } from "./connector.js";

await serveStdio(echoConnector);
