import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteRequestSchema,
  runtimeExecuteResponseSchema,
} from "@osva/runtime-protocol";

import {
  CapabilityCredential,
  createNodeHttpServer,
  createRuntime,
  createRuntimeHandler,
  RuntimeExecutionError,
  RuntimeProtocolError,
} from "../src/runtime/index.js";
import { RUNTIME_PROTOCOL_FIXTURES_DIR } from "./fixtures-path.js";

describe("Runtime SDK", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  it("handles a valid V1 execute request and returns success", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(RUNTIME_PROTOCOL_FIXTURES_DIR, "execute-request.valid.json"),
        "utf8",
      ),
    );
    const runtime = createRuntime({
      execute: async (input) => input,
    });
    const handler = createRuntimeHandler(runtime);
    const response = await handler.handleExecuteRequest(fixture);
    const parsed = runtimeExecuteResponseSchema.parse(response);
    expect(parsed.outcome).toBe("SUCCEEDED");
    expect(parsed.executionId).toBe(fixture.executionId);
  });

  it("returns a failed execution response for agent errors", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(RUNTIME_PROTOCOL_FIXTURES_DIR, "execute-request.valid.json"),
        "utf8",
      ),
    );
    const runtime = createRuntime({
      execute: async () => {
        throw new RuntimeExecutionError("boom");
      },
    });
    const response =
      await createRuntimeHandler(runtime).handleExecuteRequest(fixture);
    expect(response.outcome).toBe("FAILED");
    if (response.outcome === "FAILED") {
      expect(response.error.message).toBe("boom");
    }
  });

  it("rejects unsupported protocol versions", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          RUNTIME_PROTOCOL_FIXTURES_DIR,
          "execute-request.invalid-protocol-version.json",
        ),
        "utf8",
      ),
    );
    const runtime = createRuntime({ execute: async (input) => input });
    await expect(
      createRuntimeHandler(runtime).handleExecuteRequest(fixture),
    ).rejects.toBeInstanceOf(RuntimeProtocolError);
  });

  it("invokes model and tool capabilities through RuntimeContext", async () => {
    const capabilityServer = http.createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (req.url === RUNTIME_CAPABILITY_PATHS.generateText) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              executionId: body.executionId,
              outcome: "SUCCEEDED",
              result: { text: "model-text" },
            }),
          );
          return;
        }
        if (req.url === RUNTIME_CAPABILITY_PATHS.invokeTool) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              executionId: body.executionId,
              outcome: "SUCCEEDED",
              output: body.input,
            }),
          );
          return;
        }
        res.writeHead(404);
        res.end();
      })();
    });
    await listen(capabilityServer);
    servers.push(capabilityServer);
    const capabilityOrigin = serverOrigin(capabilityServer);

    const runtime = createRuntime({
      execute: async (_input, context) => {
        const model = await context.models.generateText({
          binding: "primary",
          messages: [{ role: "user", content: "hello" }],
        });
        const tool = await context.tools.invoke({
          binding: "echo",
          input: { value: 1 },
        });
        return { model, tool };
      },
    });

    const server = createNodeHttpServer(runtime);
    await listen(server);
    servers.push(server);

    const request = runtimeExecuteRequestSchema.parse({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId: "attempt-1",
      input: {},
      capabilities: {
        endpoint: capabilityOrigin,
        token: "secret-token",
      },
    });

    const response = await fetch(`${serverOrigin(server)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = runtimeExecuteResponseSchema.parse(await response.json());
    expect(body.outcome).toBe("SUCCEEDED");
    if (body.outcome === "SUCCEEDED") {
      expect(body.output).toEqual({
        model: { text: "model-text" },
        tool: { value: 1 },
      });
    }
  });

  it("does not expose capability tokens in credential repr/json", () => {
    const credential = new CapabilityCredential(
      "http://127.0.0.1:3000/v1/runtime/capabilities",
      "super-secret-token",
    );
    expect(JSON.stringify(credential)).not.toContain("super-secret-token");
    expect(String(credential)).not.toContain("super-secret-token");
    expect(credential.toJSON().token).toBe("[REDACTED]");
  });

  it("exposes executionId on RuntimeContext", async () => {
    const runtime = createRuntime({
      execute: async (_input, context) => ({
        executionId: context.executionId,
      }),
    });
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(RUNTIME_PROTOCOL_FIXTURES_DIR, "execute-request.valid.json"),
        "utf8",
      ),
    );
    const response =
      await createRuntimeHandler(runtime).handleExecuteRequest(fixture);
    expect(response.outcome).toBe("SUCCEEDED");
    if (response.outcome === "SUCCEEDED") {
      expect(response.output).toEqual({
        executionId: fixture.executionId,
      });
    }
  });
});

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serverOrigin(server: http.Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Server is not listening.");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}
