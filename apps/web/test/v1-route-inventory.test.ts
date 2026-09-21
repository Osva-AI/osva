import { afterEach, describe, expect, it } from "vitest";

import { V1_HTTP_ROUTES as apiKeyHttpRoutes } from "../src/api-key-http.js";
import { V1_HTTP_ROUTES as agentHttpRoutes } from "../src/agent-http.js";
import { V1_HTTP_ROUTES as artifactHttpRoutes } from "../src/artifact-http.js";
import { V1_HTTP_ROUTES as authHttpRoutes } from "../src/auth-http.js";
import { V1_HTTP_ROUTES as connectorHttpRoutes } from "../src/connector-http.js";
import { V1_HTTP_ROUTES as evaluationHttpRoutes } from "../src/evaluation-http.js";
import { V1_HTTP_ROUTES as knowledgeHttpRoutes } from "../src/knowledge-http.js";
import { V1_HTTP_ROUTES as memoryHttpRoutes } from "../src/memory-http.js";
import { V1_HTTP_ROUTES as modelProfileHttpRoutes } from "../src/model-profile-http.js";
import { V1_HTTP_ROUTES as officeHttpRoutes } from "../src/office-http.js";
import { V1_HTTP_ROUTES as runHttpRoutes } from "../src/run-http.js";
import { V1_HTTP_ROUTES as runObservabilityHttpRoutes } from "../src/run-observability-http.js";
import { V1_HTTP_ROUTES as scheduleHttpRoutes } from "../src/schedule-http.js";
import { V1_HTTP_ROUTES as toolHttpRoutes } from "../src/tool-http.js";
import { V1_HTTP_ROUTES as workflowEventHttpRoutes } from "../src/workflow-event-http.js";
import { V1_HTTP_ROUTES as workflowHttpRoutes } from "../src/workflow-http.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  V1_HANDLER_MODULES,
  V1_ROUTE_INVENTORY,
  routeInventoryKey,
} from "../src/v1-route-inventory.js";
import {
  discoverImplementedV1RouteKeys,
  inventoryStructuralRouteKeys,
} from "./support/probe-implemented-v1-routes.js";
import { authorizationHeader, createTestWebApplication } from "./test-web.js";

const HANDLER_ROUTE_EXPORTS: Readonly<
  Record<
    (typeof V1_HANDLER_MODULES)[number],
    readonly { method: string; path: string }[]
  >
> = {
  "auth-http": authHttpRoutes,
  "api-key-http": apiKeyHttpRoutes,
  "agent-http": agentHttpRoutes,
  "model-profile-http": modelProfileHttpRoutes,
  "connector-http": connectorHttpRoutes,
  "memory-http": memoryHttpRoutes,
  "artifact-http": artifactHttpRoutes,
  "knowledge-http": knowledgeHttpRoutes,
  "evaluation-http": evaluationHttpRoutes,
  "tool-http": toolHttpRoutes,
  "run-observability-http": runObservabilityHttpRoutes,
  "run-http": runHttpRoutes,
  "schedule-http": scheduleHttpRoutes,
  "workflow-http": workflowHttpRoutes,
  "workflow-event-http": workflowEventHttpRoutes,
  "office-http": officeHttpRoutes,
};

describe("V1_ROUTE_INVENTORY", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("includes every control-plane handler module", () => {
    const modules = new Set(V1_ROUTE_INVENTORY.map((route) => route.module));
    for (const handler of V1_HANDLER_MODULES) {
      expect(modules.has(handler)).toBe(true);
    }
  });

  it("matches handler module count", () => {
    expect(new Set(V1_ROUTE_INVENTORY.map((r) => r.module)).size).toBe(
      V1_HANDLER_MODULES.length,
    );
  });

  it("rejects duplicate method/path inventory entries", () => {
    const keys = V1_ROUTE_INVENTORY.map(routeInventoryKey);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("requires every handler module to export V1_HTTP_ROUTES", () => {
    for (const module of V1_HANDLER_MODULES) {
      expect(HANDLER_ROUTE_EXPORTS[module].length).toBeGreaterThan(0);
    }
  });

  it("matches implemented handler routes discovered from source probes", async () => {
    const ctx = await createTestWebApplication({
      workspaceId: "ws-route-probe" as import("@osva/contracts").WorkspaceId,
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const authHeaders = authorizationHeader(ctx.testApiKey.plaintextToken);

    const implemented = await discoverImplementedV1RouteKeys({
      origin,
      workspaceId: ctx.testApiKey.workspaceId,
      authHeaders,
    });
    const declared = inventoryStructuralRouteKeys(V1_ROUTE_INVENTORY);

    const missingFromInventory = [...implemented].filter(
      (key) => !declared.has(key),
    );
    const missingFromImplementation = [...declared].filter(
      (key) => !implemented.has(key),
    );

    expect(missingFromInventory).toEqual([]);
    expect(missingFromImplementation).toEqual([]);
  });
});
