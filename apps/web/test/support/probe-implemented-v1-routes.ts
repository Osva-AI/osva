import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HTTP_METHODS,
  enumerateProbePathsFromHandlerSource,
  officeListQuery,
  structuralKeyFromInventoryRoute,
  structuralRouteKey,
} from "./v1-http-route-discovery.js";
import type { V1HandlerModule } from "../../src/v1-route-inventory.js";
import { V1_HANDLER_MODULES } from "../../src/v1-route-inventory.js";

const webSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

function readHandlerSource(module: V1HandlerModule): string {
  return fs.readFileSync(path.join(webSrc, `${module}.ts`), "utf8");
}

function isUnhandledNotFound(status: number, body: unknown): boolean {
  return (
    status === 404 &&
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    (body as { status?: string }).status === "not_found"
  );
}

async function isPathRecognizedByHandlers(
  origin: string,
  pathWithQuery: string,
  headers: Record<string, string>,
): Promise<boolean> {
  for (const method of ["GET", "POST"] as const) {
    const init: RequestInit = { method, headers };
    if (method === "POST") {
      init.headers = { ...headers, "content-type": "application/json" };
      init.body = "{}";
    }

    const response = await fetch(`${origin}${pathWithQuery}`, init);
    if (response.status === 405) {
      return true;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!isUnhandledNotFound(response.status, body)) {
      return true;
    }
  }

  return false;
}

async function probeMethodImplemented(
  origin: string,
  pathWithQuery: string,
  method: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const init: RequestInit = { method, headers };
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    init.headers = {
      ...headers,
      "content-type": "application/json",
    };
    init.body = "{}";
  }

  const response = await fetch(`${origin}${pathWithQuery}`, init);
  if (response.status === 405) {
    return false;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (isUnhandledNotFound(response.status, body)) {
    return false;
  }

  return true;
}

export async function discoverImplementedV1RouteKeys(options: {
  readonly origin: string;
  readonly workspaceId: string;
  readonly authHeaders: Record<string, string>;
}): Promise<Set<string>> {
  const implemented = new Set<string>();

  for (const module of V1_HANDLER_MODULES) {
    const source = readHandlerSource(module);
    const probePaths = enumerateProbePathsFromHandlerSource(source);

    for (const probePath of probePaths) {
      const query = officeListQuery();
      const pathWithQuery = `${probePath}${query}`;
      const recognized = await isPathRecognizedByHandlers(
        options.origin,
        pathWithQuery,
        options.authHeaders,
      );
      if (!recognized) {
        continue;
      }

      for (const method of HTTP_METHODS) {
        const active = await probeMethodImplemented(
          options.origin,
          pathWithQuery,
          method,
          options.authHeaders,
        );
        if (active) {
          implemented.add(structuralRouteKey(method, probePath));
        }
      }
    }
  }

  return implemented;
}

export function inventoryStructuralRouteKeys(
  inventory: readonly { method: string; path: string }[],
): Set<string> {
  const keys = inventory.map((route) => structuralKeyFromInventoryRoute(route));
  return new Set(keys);
}

export function readHandlerSourceForModule(module: V1HandlerModule): string {
  return readHandlerSource(module);
}
