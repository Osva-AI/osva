import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { OsvaApiError } from "@osva-ai/sdk";
import type { WorkflowRunId, WorkflowRunResourceV1 } from "@osva-ai/contracts";

import {
  buildWorkflowRunInput,
  generateRequestId,
} from "../scripts/lib/args.js";
import {
  type OperatorEnv,
  OperatorConfigurationError,
} from "../scripts/lib/operator-env.js";
import { evaluateCanonicalDemoReadinessWithApi } from "./canonical-readiness.js";
import { loadDemoServerOperatorEnv } from "./demo-operator-env.js";
import {
  OperatorApi,
  OperatorSetupError,
} from "../scripts/lib/operator-client.js";
import { readCanonicalState } from "../scripts/lib/state.js";
import {
  DemoOperatorMutationError,
  executeApprovalMutation,
  executeDeliveryEventMutation,
  parseApprovalMutationBody,
} from "./operator-mutations.js";
import { buildCanonicalDemoReadModel } from "./read-model.js";
import {
  DemoReportArtifactError,
  contentDispositionAttachmentFilename,
  readCanonicalReportArtifactBytes,
  readCanonicalReportArtifactContent,
} from "./report-artifact.js";
import { demoPublicDir } from "./paths.js";
import {
  type ResponseSecurityOptions,
  safeDemoErrorMessage,
  serializedResponseContainsSecretMaterial,
} from "./response-security.js";

export interface DemoServerOptions {
  readonly port?: number;
  readonly env?: OperatorEnv;
  readonly apiFactory?: (env: OperatorEnv) => OperatorApi;
}

async function resolveDemoServerEnv(
  options: DemoServerOptions,
): Promise<OperatorEnv> {
  return options.env ?? (await loadDemoServerOperatorEnv());
}

function responseSecurityFromEnv(
  env: OperatorEnv | undefined,
): ResponseSecurityOptions {
  if (env === undefined) {
    return {};
  }
  return { forbiddenLiteralSubstrings: [env.apiKey] };
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  security: ResponseSecurityOptions = {},
): void {
  const serialized = JSON.stringify(body);
  if (serializedResponseContainsSecretMaterial(serialized, security)) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal response redaction failure." }));
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(serialized);
}

function jsonReportArtifactPreviewResponse(
  res: http.ServerResponse,
  status: number,
  metadata: unknown,
  content: string,
  security: ResponseSecurityOptions = {},
): void {
  const metadataSerialized = JSON.stringify(metadata);
  if (serializedResponseContainsSecretMaterial(metadataSerialized, security)) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal response redaction failure." }));
    return;
  }
  const serialized = JSON.stringify({ metadata, content });
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(serialized);
}

async function loadWorkflowRunForDemo(
  api: OperatorApi,
  workflowRunId: WorkflowRunId,
  res: http.ServerResponse,
): Promise<WorkflowRunResourceV1 | undefined> {
  try {
    return await api.sdk.workflowRuns.get(workflowRunId);
  } catch (error) {
    if (error instanceof OsvaApiError && error.status === 404) {
      jsonResponse(res, 404, { error: "Workflow run not found." });
      return undefined;
    }
    if (error instanceof OsvaApiError) {
      jsonResponse(res, error.status, { error: error.message });
      return undefined;
    }
    throw error;
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as unknown;
}

function toolVersionLookupFromState(
  state: NonNullable<Awaited<ReturnType<typeof readCanonicalState>>>,
): Map<string, string> {
  const map = new Map<string, string>();
  map.set(
    state.tools.npmPackageMetadata.toolVersionId,
    state.tools.npmPackageMetadata.toolId,
  );
  map.set(
    state.tools.npmDownloads.toolVersionId,
    state.tools.npmDownloads.toolId,
  );
  return map;
}

export function createDemoServer(options: DemoServerOptions = {}): http.Server {
  const publicDir = demoPublicDir();

  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (method === "GET" && url.pathname === "/") {
        const html = await readFile(path.join(publicDir, "index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (method === "GET" && url.pathname === "/app.js") {
        const js = await readFile(path.join(publicDir, "app.js"), "utf8");
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
        });
        res.end(js);
        return;
      }

      if (method === "GET" && url.pathname === "/node-detail-lifecycle.js") {
        const js = await readFile(
          path.join(publicDir, "node-detail-lifecycle.js"),
          "utf8",
        );
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
        });
        res.end(js);
        return;
      }

      if (method === "GET" && url.pathname === "/approval-comment.js") {
        const js = await readFile(
          path.join(publicDir, "approval-comment.js"),
          "utf8",
        );
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
        });
        res.end(js);
        return;
      }

      if (method === "GET" && url.pathname === "/styles.css") {
        const css = await readFile(path.join(publicDir, "styles.css"), "utf8");
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
        return;
      }

      if (method === "GET" && url.pathname === "/api/canonical/state") {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, {
              ready: false,
              reason: "OPERATOR_ENV_NOT_CONFIGURED",
              error: error.message,
            });
            return;
          }
          throw error;
        }

        const api = options.apiFactory?.(env) ?? new OperatorApi(env);
        const readiness = await evaluateCanonicalDemoReadinessWithApi(
          api,
          env.workspaceId,
        );
        jsonResponse(res, 200, readiness, responseSecurityFromEnv(env));
        return;
      }

      if (method === "POST" && url.pathname === "/api/canonical/runs") {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const api = options.apiFactory?.(env) ?? new OperatorApi(env);
        let state;
        try {
          state = await api.loadVerifiedCanonicalState(env.workspaceId);
        } catch (error) {
          if (error instanceof OperatorSetupError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const packageName =
          typeof body.packageName === "string" ? body.packageName.trim() : "";
        const useCase =
          typeof body.useCase === "string" ? body.useCase.trim() : "";
        const requestId =
          typeof body.requestId === "string" && body.requestId.length > 0
            ? body.requestId
            : generateRequestId();
        const constraintsRaw = body.constraints;
        const constraints = Array.isArray(constraintsRaw)
          ? constraintsRaw.filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0,
            )
          : [];

        if (packageName.length === 0 || useCase.length === 0) {
          jsonResponse(res, 400, {
            error: "packageName and useCase are required.",
          });
          return;
        }

        const input = buildWorkflowRunInput({
          requestId,
          packageName,
          useCase,
          constraints,
        });

        const created = await api.sdk.workflowRuns.create({
          workflowVersionId: state.workflowVersionId as never,
          input,
        });

        jsonResponse(
          res,
          201,
          {
            workflowRunId: created.id,
            requestId,
            packageName,
            useCase,
            constraints,
            status: created.status,
          },
          responseSecurityFromEnv(env),
        );
        return;
      }

      const approvalMatch = url.pathname.match(
        /^\/api\/canonical\/runs\/([^/]+)\/approval$/,
      );
      if (method === "POST" && approvalMatch !== null) {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const workflowRunId = decodeURIComponent(
          approvalMatch[1]!,
        ) as WorkflowRunId;
        const api = options.apiFactory?.(env) ?? new OperatorApi(env);
        const body = await readJsonBody(req);
        const parsed = parseApprovalMutationBody(body);
        if (parsed instanceof DemoOperatorMutationError) {
          jsonResponse(
            res,
            parsed.status,
            { error: parsed.message },
            responseSecurityFromEnv(env),
          );
          return;
        }

        try {
          const result = await executeApprovalMutation(
            api,
            workflowRunId,
            parsed,
          );
          jsonResponse(res, 200, result, responseSecurityFromEnv(env));
        } catch (error) {
          if (error instanceof DemoOperatorMutationError) {
            jsonResponse(
              res,
              error.status,
              { error: error.message },
              responseSecurityFromEnv(env),
            );
            return;
          }
          throw error;
        }
        return;
      }

      const deliveryEventMatch = url.pathname.match(
        /^\/api\/canonical\/runs\/([^/]+)\/delivery-event$/,
      );
      if (method === "POST" && deliveryEventMatch !== null) {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const workflowRunId = decodeURIComponent(
          deliveryEventMatch[1]!,
        ) as WorkflowRunId;
        const api = options.apiFactory?.(env) ?? new OperatorApi(env);

        try {
          const result = await executeDeliveryEventMutation(api, workflowRunId);
          jsonResponse(res, 201, result, responseSecurityFromEnv(env));
        } catch (error) {
          if (error instanceof DemoOperatorMutationError) {
            jsonResponse(
              res,
              error.status,
              { error: error.message },
              responseSecurityFromEnv(env),
            );
            return;
          }
          throw error;
        }
        return;
      }

      const reportArtifactDownloadMatch = url.pathname.match(
        /^\/api\/canonical\/runs\/([^/]+)\/report-artifact\/download$/,
      );
      if (method === "GET" && reportArtifactDownloadMatch !== null) {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const workflowRunId = decodeURIComponent(
          reportArtifactDownloadMatch[1]!,
        ) as WorkflowRunId;
        const api = options.apiFactory?.(env) ?? new OperatorApi(env);
        const security = responseSecurityFromEnv(env);

        const run = await loadWorkflowRunForDemo(api, workflowRunId, res);
        if (run === undefined) {
          return;
        }

        try {
          const { metadata, bytes } = await readCanonicalReportArtifactBytes(
            api,
            run,
          );
          const filename = contentDispositionAttachmentFilename(metadata.name);
          res.writeHead(200, {
            "Content-Type": metadata.mediaType,
            "Content-Length": String(bytes.length),
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          });
          res.end(bytes);
        } catch (error) {
          if (error instanceof DemoReportArtifactError) {
            jsonResponse(res, error.status, { error: error.message }, security);
            return;
          }
          throw error;
        }
        return;
      }

      const reportArtifactMatch = url.pathname.match(
        /^\/api\/canonical\/runs\/([^/]+)\/report-artifact$/,
      );
      if (method === "GET" && reportArtifactMatch !== null) {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const workflowRunId = decodeURIComponent(
          reportArtifactMatch[1]!,
        ) as WorkflowRunId;
        const api = options.apiFactory?.(env) ?? new OperatorApi(env);
        const security = responseSecurityFromEnv(env);

        const run = await loadWorkflowRunForDemo(api, workflowRunId, res);
        if (run === undefined) {
          return;
        }

        try {
          const preview = await readCanonicalReportArtifactContent(api, run);
          jsonReportArtifactPreviewResponse(
            res,
            200,
            preview.metadata,
            preview.content,
            security,
          );
        } catch (error) {
          if (error instanceof DemoReportArtifactError) {
            jsonResponse(res, error.status, { error: error.message }, security);
            return;
          }
          throw error;
        }
        return;
      }

      const runMatch = url.pathname.match(/^\/api\/canonical\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch !== null) {
        let env;
        try {
          env = await resolveDemoServerEnv(options);
        } catch (error) {
          if (error instanceof OperatorConfigurationError) {
            jsonResponse(res, 503, { error: error.message });
            return;
          }
          throw error;
        }

        const workflowRunId = decodeURIComponent(runMatch[1]!) as WorkflowRunId;
        const api = options.apiFactory?.(env) ?? new OperatorApi(env);

        let run;
        try {
          run = await api.sdk.workflowRuns.get(workflowRunId);
        } catch (error) {
          if (error instanceof OsvaApiError && error.status === 404) {
            jsonResponse(res, 404, { error: "Workflow run not found." });
            return;
          }
          if (error instanceof OsvaApiError) {
            jsonResponse(res, error.status, {
              error: error.message,
            });
            return;
          }
          throw error;
        }

        let definition: unknown = {};
        try {
          const version = await api.sdk.workflows.getVersion(
            run.workflowId as never,
            run.workflowVersionId as never,
          );
          definition = version.definition;
        } catch {
          // Definition enrichment is optional.
        }

        const state = await readCanonicalState();
        const toolVersionIdToToolId =
          state !== null ? toolVersionLookupFromState(state) : undefined;

        const model = await buildCanonicalDemoReadModel(api, run, definition, {
          toolVersionIdToToolId,
        });
        jsonResponse(res, 200, model, responseSecurityFromEnv(env));
        return;
      }

      jsonResponse(res, 404, { error: "Not found." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Demo server error.";
      jsonResponse(res, 500, {
        error: safeDemoErrorMessage(message),
      });
    }
  });
}

export function resolveDemoPort(): number {
  const raw = process.env.CANONICAL_DEMO_PORT?.trim();
  if (raw === undefined || raw.length === 0) {
    return 4173;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error("CANONICAL_DEMO_PORT must be a valid TCP port.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const port = resolveDemoPort();
  const server = createDemoServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  console.log("OSVA Canonical Dependency Adoption Demo");
  console.log("");
  console.log(`Open: http://127.0.0.1:${port}`);
  console.log("");
  console.log("The browser talks to this local demo server only.");
  console.log("OSVA_API_KEY stays on the server.");
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
