import { serveStreamableHttp } from "@osva/connector-sdk";

import { echoConnector } from "./connector.js";

const host = process.env.OSVA_ECHO_CONNECTOR_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.OSVA_ECHO_CONNECTOR_PORT ?? "0", 10);

const server = await serveStreamableHttp({
  connector: echoConnector,
  host,
  port: Number.isNaN(port) ? 0 : port,
});

const address = server.address();
if (address !== null && typeof address === "object") {
  process.stdout.write(
    `${JSON.stringify({
      event: "echo_connector.http_listening",
      host,
      port: address.port,
      path: "/mcp",
    })}\n`,
  );
}
