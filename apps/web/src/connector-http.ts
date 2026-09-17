import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConnectorId, ConnectorVersionId } from "@osva/contracts";
import {
  connectorListResourceSchema,
  connectorResourceSchema,
  connectorVersionListResourceSchema,
  connectorVersionResourceSchema,
  createConnectorRequestSchema,
  createConnectorVersionRequestSchema,
  discoverConnectorToolsResponseSchema,
  importMcpToolsRequestSchema,
  importMcpToolsResponseSchema,
  updateConnectorRequestSchema,
} from "@osva/contracts/schemas";
import type {
  Connector,
  ConnectorApplication,
  ConnectorVersion,
} from "@osva/domain";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleConnectorRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  connectors: ConnectorApplication,
): Promise<boolean> {
  const route = matchConnectorRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchConnectorRoute(request, response, method, route, connectors);
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ConnectorRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly connectorId: ConnectorId }
  | { readonly kind: "versions"; readonly connectorId: ConnectorId }
  | {
      readonly kind: "version";
      readonly connectorId: ConnectorId;
      readonly connectorVersionId: ConnectorVersionId;
    }
  | {
      readonly kind: "discover";
      readonly connectorId: ConnectorId;
      readonly connectorVersionId: ConnectorVersionId;
    }
  | { readonly kind: "import-tools" };

async function dispatchConnectorRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ConnectorRoute,
  connectors: ConnectorApplication,
): Promise<void> {
  if (route.kind === "import-tools") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }

    const parsed = importMcpToolsRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    const imported = await connectors.importMcpTools.execute(parsed.data);
    sendJson(
      response,
      200,
      importMcpToolsResponseSchema.parse({
        imported: imported.map((item) => ({
          toolId: item.toolId,
          toolVersionId: item.toolVersionId,
          remoteToolName: item.remoteToolName,
          toolKey: item.toolKey,
          createdNewToolVersion: item.createdNewToolVersion,
        })),
      }),
    );
    return;
  }

  if (route.kind === "discover") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }

    await connectors.getConnectorVersion.execute({
      connectorId: route.connectorId,
      connectorVersionId: route.connectorVersionId,
    });
    const tools = await connectors.discoverConnectorTools.execute({
      connectorVersionId: route.connectorVersionId,
    });
    sendJson(
      response,
      200,
      discoverConnectorToolsResponseSchema.parse({
        connectorVersionId: route.connectorVersionId,
        tools,
      }),
    );
    return;
  }

  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await connectors.listConnectors.execute();
      sendJson(response, 200, toConnectorListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createConnectorRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await connectors.createConnector.execute(parsed.data);
      sendJson(response, 201, toConnectorResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method === "GET") {
      const connector = await connectors.getConnector.execute(
        route.connectorId,
      );
      sendJson(response, 200, toConnectorResource(connector));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateConnectorRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await connectors.updateConnectorMetadata.execute({
        connectorId: route.connectorId,
        ...parsed.data,
      });
      sendJson(response, 200, toConnectorResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "versions") {
    if (method === "GET") {
      const versions = await connectors.listConnectorVersions.execute(
        route.connectorId,
      );
      sendJson(response, 200, toConnectorVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createConnectorVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await connectors.appendConnectorVersion.execute({
        connectorId: route.connectorId,
        ...parsed.data,
      });
      sendJson(response, 201, toConnectorVersionResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (method === "GET") {
    const version = await connectors.getConnectorVersion.execute({
      connectorId: route.connectorId,
      connectorVersionId: route.connectorVersionId,
    });
    sendJson(response, 200, toConnectorVersionResource(version));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchConnectorRoute(path: string): ConnectorRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (
    segments.length === 2 &&
    segments[0] === "v1" &&
    segments[1] === "connectors"
  ) {
    return { kind: "collection" };
  }

  if (
    segments.length === 3 &&
    segments[0] === "v1" &&
    segments[1] === "connectors" &&
    segments[2] === "import-mcp-tools"
  ) {
    return { kind: "import-tools" };
  }

  if (
    segments.length === 3 &&
    segments[0] === "v1" &&
    segments[1] === "connectors"
  ) {
    return {
      kind: "item",
      connectorId: decodeURIComponent(segments[2]!) as ConnectorId,
    };
  }

  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "connectors" &&
    segments[3] === "versions"
  ) {
    return {
      kind: "versions",
      connectorId: decodeURIComponent(segments[2]!) as ConnectorId,
    };
  }

  if (
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "connectors" &&
    segments[3] === "versions"
  ) {
    return {
      kind: "version",
      connectorId: decodeURIComponent(segments[2]!) as ConnectorId,
      connectorVersionId: decodeURIComponent(
        segments[4]!,
      ) as ConnectorVersionId,
    };
  }

  if (
    segments.length === 6 &&
    segments[0] === "v1" &&
    segments[1] === "connectors" &&
    segments[3] === "versions" &&
    segments[5] === "discover"
  ) {
    return {
      kind: "discover",
      connectorId: decodeURIComponent(segments[2]!) as ConnectorId,
      connectorVersionId: decodeURIComponent(
        segments[4]!,
      ) as ConnectorVersionId,
    };
  }

  return undefined;
}

function toConnectorResource(connector: Connector) {
  return connectorResourceSchema.parse({
    id: connector.id,
    workspaceId: connector.workspaceId,
    key: connector.key,
    name: connector.name,
    description: connector.description,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  });
}

function toConnectorListResource(items: readonly Connector[]) {
  return connectorListResourceSchema.parse({
    connectors: items.map((connector) => toConnectorResource(connector)),
  });
}

function toConnectorVersionResource(version: ConnectorVersion) {
  return connectorVersionResourceSchema.parse({
    id: version.id,
    connectorId: version.connectorId,
    version: version.version,
    kind: version.kind,
    transport: version.transport,
    transportConfig: version.transportConfig,
    auth: version.auth,
    createdAt: version.createdAt.toISOString(),
  });
}

function toConnectorVersionListResource(versions: readonly ConnectorVersion[]) {
  return connectorVersionListResourceSchema.parse({
    versions: versions.map((version) => toConnectorVersionResource(version)),
  });
}
