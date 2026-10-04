import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultClientDistDir,
  loadConsoleConfig,
  tryLoadConsoleConfig,
  type ConsoleConfig,
} from "./config.js";
import {
  createConsoleOsvaClient,
  type ConsoleOsvaClient,
} from "./osva-client.js";
import { handleConsoleApiRequest } from "./routes/api.js";

export interface ConsoleServerOptions {
  readonly config?: ConsoleConfig;
  readonly client?: ConsoleOsvaClient;
}

export function createConsoleServer(
  options: ConsoleServerOptions = {},
): http.Server {
  const config = options.config ?? tryLoadConsoleConfig();
  const client =
    options.client ??
    (config === undefined ? undefined : createConsoleOsvaClient(config));
  const security =
    config === undefined
      ? {}
      : { forbiddenLiteralSubstrings: [config.osvaApiKey] };
  const clientDistDir = config?.clientDistDir ?? defaultClientDistDir();

  return http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    const handledApi = await handleConsoleApiRequest(
      request,
      response,
      pathname,
      url.searchParams,
      { client, security },
    );
    if (handledApi) {
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const assetPath = resolveClientAssetPath(pathname, clientDistDir);
    if (assetPath === undefined) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }

    try {
      if (method === "HEAD") {
        response.writeHead(200, contentTypeForAsset(assetPath));
        response.end();
        return;
      }
      const contents = await readFile(assetPath);
      response.writeHead(200, contentTypeForAsset(assetPath));
      response.end(contents);
    } catch {
      if (shouldServeSpaShell(pathname)) {
        await serveSpaShell(response, clientDistDir);
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
    }
  });
}

export function startConsoleServer(
  options: ConsoleServerOptions = {},
): http.Server {
  const config = options.config ?? loadConsoleConfig();
  const server = createConsoleServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(
      `OSVA console listening on http://${config.host}:${config.port}`,
    );
  });
  return server;
}

function resolveClientAssetPath(
  pathname: string,
  clientDistDir: string,
): string | undefined {
  if (shouldServeSpaShell(pathname)) {
    return path.join(clientDistDir, "index.html");
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(clientDistDir, normalized);
  const resolvedRoot = path.resolve(clientDistDir);
  if (!path.resolve(candidate).startsWith(resolvedRoot)) {
    return undefined;
  }
  return candidate;
}

function shouldServeSpaShell(pathname: string): boolean {
  return pathname === "/" || !pathname.includes(".");
}

async function serveSpaShell(
  response: http.ServerResponse,
  clientDistDir: string,
): Promise<void> {
  try {
    const indexHtml = await readFile(
      path.join(clientDistDir, "index.html"),
      "utf8",
    );
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      "Console frontend is not built. Run pnpm --filter @osva/console build.",
    );
  }
}

function contentTypeForAsset(filePath: string): Record<string, string> {
  if (filePath.endsWith(".html")) {
    return { "Content-Type": "text/html; charset=utf-8" };
  }
  if (filePath.endsWith(".js")) {
    return { "Content-Type": "application/javascript; charset=utf-8" };
  }
  if (filePath.endsWith(".css")) {
    return { "Content-Type": "text/css; charset=utf-8" };
  }
  if (filePath.endsWith(".svg")) {
    return { "Content-Type": "image/svg+xml" };
  }
  return { "Content-Type": "application/octet-stream" };
}
