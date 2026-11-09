/**
 * M20.7.2 — isolated OpenAI Chat Completions schema probe (operator-controlled).
 *
 * Default: dry-run only (non-billable). No OSVA stack, DB, or worker.
 *
 * Execute (billable, one HTTP attempt):
 *   OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE=1 OPENAI_API_KEY=... node scripts/acceptance/m20-7/openai-builder-schema-probe.mjs
 *
 * Mocked provider (non-billable exit-path test):
 *   OSVA_M20_7_OPENAI_SCHEMA_PROBE_MOCK=1 OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE=1 node ...
 *
 * Redacts credentials; does not log request headers, raw response bodies, or prompts.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(
  resolve(repoRoot, "adapters/model-openai/package.json"),
);
const OpenAI = require("openai");
const schemaModuleUrl = pathToFileURL(
  resolve(
    repoRoot,
    "packages/domain/dist/builder/builder-proposal-openai-json-schema.js",
  ),
).href;

const EXECUTE = process.env.OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE === "1";
const MOCK = process.env.OSVA_M20_7_OPENAI_SCHEMA_PROBE_MOCK === "1";
const MODEL = (process.env.OSVA_M20_7_PROBE_MODEL ?? "gpt-4o-mini").trim();
const BASE_URL = (
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
).replace(/\/+$/, "");

function failExit(code) {
  process.exitCode = code;
}

async function loadSchema() {
  const mod = await import(schemaModuleUrl);
  return mod.BuilderProposalOpenAiJsonSchema;
}

function redactRequestId(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

async function startMockOpenAI() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      void body;
      res.writeHead(400, {
        "content-type": "application/json",
        "x-request-id": "req_mock_schema_probe",
      });
      res.end(
        JSON.stringify({
          error: {
            message:
              "Invalid schema for response_format 'agent_output': In context=('properties', 'agents', 'items', 'anyOf', '0', 'properties', 'kind'), schema must have a 'type' key.",
            type: "invalid_request_error",
            param: "response_format",
            code: "invalid_json_schema",
          },
        }),
      );
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        rejectListen(error);
        return;
      }
      resolveListen();
    });
  });
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("mock server bind failed");
  }
  return {
    origin: `http://127.0.0.1:${String(addr.port)}/v1`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolveClose();
        });
      }),
  };
}

async function main() {
  const schema = await loadSchema();
  const envelopeBytes = JSON.stringify({
    type: "json_schema",
    json_schema: { name: "agent_output", schema, strict: true },
  }).length;

  let mock;
  let effectiveBaseUrl = BASE_URL;
  if (MOCK) {
    mock = await startMockOpenAI();
    effectiveBaseUrl = mock.origin;
  }

  try {
    console.log(
      JSON.stringify(
        {
          mode: EXECUTE ? "execute" : "dry_run",
          mockProvider: MOCK,
          model: MODEL,
          baseUrlHost: new URL(`${effectiveBaseUrl}/`).host,
          schemaBytes: JSON.stringify(schema).length,
          envelopeBytes,
          sdkVersion: require(
            resolve(
              repoRoot,
              "adapters/model-openai/node_modules/openai/package.json",
            ),
          ).version,
          maxRetries: 0,
          maxTokens: 1,
          executeEnv: "OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE=1",
        },
        null,
        2,
      ),
    );

    if (!EXECUTE) {
      console.log(
        "PROBE_DRY_RUN: set OSVA_M20_7_OPENAI_SCHEMA_PROBE_EXECUTE=1 to perform one billable probe call.",
      );
      return;
    }

    const apiKey = MOCK ? "mock-probe-key" : process.env.OPENAI_API_KEY?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      console.error("OPENAI_API_KEY required when probe execute is enabled.");
      failExit(2);
      return;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: effectiveBaseUrl,
      maxRetries: 0,
    });

    try {
      await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: "Return minimal valid builder proposal json.",
          },
        ],
        max_tokens: 1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "agent_output",
            schema,
            strict: true,
          },
        },
      });
      console.log(
        JSON.stringify({ outcome: "unexpected_success", httpStatus: 200 }),
      );
    } catch (error) {
      const status =
        typeof error?.status === "number" ? error.status : undefined;
      const requestId = redactRequestId(error?.headers?.get?.("x-request-id"));
      const body =
        error?.error !== null && typeof error?.error === "object"
          ? error.error
          : {};
      const nested =
        body.error !== null && typeof body.error === "object"
          ? body.error
          : body;

      console.log(
        JSON.stringify(
          {
            outcome: "provider_error",
            httpStatus: status,
            errorMessage:
              typeof nested.message === "string"
                ? nested.message.slice(0, 512)
                : undefined,
            errorType:
              typeof nested.type === "string" ? nested.type : undefined,
            errorCode:
              typeof nested.code === "string" ? nested.code : undefined,
            errorParam:
              typeof nested.param === "string" ? nested.param : undefined,
            requestId,
          },
          null,
          2,
        ),
      );
      failExit(1);
    }
  } finally {
    if (mock !== undefined) {
      await mock.close();
    }
  }
}

main()
  .catch((error) => {
    console.error("PROBE_FAILED", error?.message ?? String(error));
    failExit(2);
  })
  .then(() => {
    const code = process.exitCode ?? 0;
    if (code === 0) {
      return undefined;
    }
    return new Promise((resolve) => {
      setImmediate(() => {
        process.exit(code);
        resolve();
      });
    });
  });
