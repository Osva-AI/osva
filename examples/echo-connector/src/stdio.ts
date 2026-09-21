import { serveStdio } from "@osva/connector-sdk";

import { echoConnector } from "./connector.js";

await serveStdio(echoConnector);
