import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isCanonicalJsonValue } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { sha256IntegrityOf } from "../src/integrity.js";
import { RuntimeErrorCode } from "../src/constants.js";
import { TrustedTypeScriptRuntimeAdapter } from "../src/trusted-typescript-runtime-adapter.js";
import {
  createTrustedRequest,
  modelBindings,
  toolBindings,
} from "./execution-request.js";
import { createTrustedRoot, installFixture } from "./temp-root.js";

const PARENT_PID = process.pid;

async function adapterFor(root: string, entrypoint: string, timeoutMs = 5_000) {
  const artifact = await fs.readFile(path.join(root, entrypoint));
  return {
    adapter: new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
    }),
    request: createTrustedRequest({
      timeoutMs,
      runtime: {
        type: "TRUSTED_TYPESCRIPT",
        entrypoint,
        integrity: sha256IntegrityOf(artifact),
      },
    }),
  };
}

describe("TrustedTypeScriptRuntimeAdapter", () => {
  it("executes a trusted async run(context) module and returns JSON output", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "echo-agent.ts");
    const { adapter, request } = await adapterFor(root, "echo-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "succeeded",
        output: {
          echoed: request.input,
          ids: {
            runId: request.runId,
            runAttemptId: request.runAttemptId,
            workspaceId: request.workspaceId,
            agentId: request.agentId,
            agentVersionId: request.agentVersionId,
          },
          contextKeys: [
            "agentId",
            "agentVersionId",
            "input",
            "memory",
            "models",
            "runAttemptId",
            "runId",
            "tools",
            "workspaceId",
          ],
          hasJobId: false,
          databaseUrl: null,
          valkeyUrl: null,
          openaiApiKey: null,
          hasModels: true,
          modelKeys: ["generateText"],
          hasTools: true,
          toolKeys: ["invoke"],
        },
      });
    } finally {
      await adapter.close();
    }
  });

  it("does not put BullMQ, PostgreSQL, or Valkey handles on the agent context", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "echo-agent.ts");
    const { adapter, request } = await adapterFor(root, "echo-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result.status).toBe("succeeded");
      if (result.status !== "succeeded") {
        return;
      }

      const output = result.output as {
        contextKeys: string[];
        hasJobId: boolean;
      };
      expect(output.contextKeys).not.toContain("jobId");
      expect(output.contextKeys).not.toContain("job");
      expect(output.contextKeys).not.toContain("database");
      expect(output.contextKeys).not.toContain("queue");
      expect(output.hasJobId).toBe(false);
    } finally {
      await adapter.close();
    }
  });

  it("rejects an absolute or traversing entrypoint without executing it", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "echo-agent.ts");
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
    });

    try {
      const absolute = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: path.join(root, "echo-agent.ts"),
            integrity: `sha256:${"a".repeat(64)}`,
          },
        }),
      );
      expect(absolute).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.PATH_ESCAPE },
      });

      const traversal = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "../echo-agent.ts",
            integrity: `sha256:${"a".repeat(64)}`,
          },
        }),
      );
      expect(traversal).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.PATH_ESCAPE },
      });
      expect(JSON.stringify(traversal)).not.toContain(root);
    } finally {
      await adapter.close();
    }
  });

  it("rejects a symlink that escapes the trusted runtime root", async () => {
    const root = await createTrustedRoot();
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-outside-"),
    );
    const outsideFile = await installFixture(
      outsideDir,
      "echo-agent.ts",
      "escaped.ts",
    );

    const linkInside = path.join(root, "escaped.ts");
    try {
      await fs.symlink(outsideFile, linkInside);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "ENOTSUP")
      ) {
        return;
      }
      throw error;
    }

    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
    });
    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "escaped.ts",
            integrity: sha256IntegrityOf(await fs.readFile(outsideFile)),
          },
        }),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.PATH_ESCAPE },
      });
    } finally {
      await adapter.close();
    }
  });

  it("fails when the stored digest does not match a modified artifact", async () => {
    const root = await createTrustedRoot();
    const dest = await installFixture(root, "echo-agent.ts");
    const originalDigest = sha256IntegrityOf(await fs.readFile(dest));
    await fs.writeFile(
      dest,
      "export async function run() { return { mutated: true }; }\n",
    );

    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
    });
    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-agent.ts",
            integrity: originalDigest,
          },
        }),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.INTEGRITY_MISMATCH },
      });
    } finally {
      await adapter.close();
    }
  });

  it("fails cleanly when the trusted artifact is missing", async () => {
    const root = await createTrustedRoot();
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
    });
    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "missing-agent.ts",
            integrity: `sha256:${"a".repeat(64)}`,
          },
        }),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.ARTIFACT_NOT_FOUND },
      });
    } finally {
      await adapter.close();
    }
  });

  it("fails when the module does not export run", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "missing-run-agent.ts");
    const { adapter, request } = await adapterFor(root, "missing-run-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.INVALID_MODULE },
      });
    } finally {
      await adapter.close();
    }
  });

  it("maps a thrown agent error to an execution failure", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "throw-agent.ts");
    const { adapter, request } = await adapterFor(root, "throw-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result.status).toBe("failed");
      if (result.status !== "failed") {
        return;
      }
      expect(result.error.code).toBe(RuntimeErrorCode.AGENT_ERROR);
      expect(result.error.message).toContain("agent rejected input");
    } finally {
      await adapter.close();
    }
  });

  it("terminates a non-returning agent at the immutable timeout without killing the parent", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "hang-agent.ts");
    const { adapter, request } = await adapterFor(root, "hang-agent.ts", 200);

    try {
      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.TIMEOUT },
      });
      expect(process.pid).toBe(PARENT_PID);
    } finally {
      await adapter.close();
    }
  });

  it("isolates child process.exit from the parent worker process", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "exit-agent.ts");
    const { adapter, request } = await adapterFor(root, "exit-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result.status).toBe("failed");
      expect(process.pid).toBe(PARENT_PID);
    } finally {
      await adapter.close();
    }
  });

  it("rejects non-JSON-compatible runtime output", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "invalid-output-agent.ts");
    const { adapter, request } = await adapterFor(
      root,
      "invalid-output-agent.ts",
    );

    try {
      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.INVALID_OUTPUT },
      });
    } finally {
      await adapter.close();
    }
  });

  it("keeps agent stdout off the execution result channel", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "console-agent.ts");
    const { adapter, request } = await adapterFor(root, "console-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result).toEqual({
        status: "succeeded",
        output: { echoed: request.input },
      });
    } finally {
      await adapter.close();
    }
  });

  it("denies accidental filesystem writes under the Node permission model", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "write-attempt-agent.ts");
    const { adapter, request } = await adapterFor(
      root,
      "write-attempt-agent.ts",
    );

    try {
      const result = await adapter.execute(request);
      expect(result.status).toBe("succeeded");
      if (result.status !== "succeeded") {
        return;
      }

      expect(result.output).toMatchObject({
        wrote: false,
        code: "ERR_ACCESS_DENIED",
      });
    } finally {
      await adapter.close();
    }
  });

  it("exposes generateText without provider IDs, SDK clients, or OPENAI_API_KEY", async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-secret-must-not-reach-child";
    const root = await createTrustedRoot();
    await installFixture(root, "model-inspect-agent.ts");
    const { adapter, request } = await adapterFor(
      root,
      "model-inspect-agent.ts",
    );

    try {
      const result = await adapter.execute(request);
      expect(result.status).toBe("succeeded");
      if (result.status !== "succeeded") {
        return;
      }

      expect(result.output).toMatchObject({
        contextKeys: [
          "agentId",
          "agentVersionId",
          "input",
          "memory",
          "models",
          "runAttemptId",
          "runId",
          "tools",
          "workspaceId",
        ],
        modelKeys: ["generateText"],
        openaiApiKey: null,
        hasGenerateText: true,
        hasProvider: false,
        hasOpenAI: false,
        hasApiKey: false,
        hasClient: false,
        hasModelProfileVersionId: false,
      });
      expect(JSON.stringify(result)).not.toContain("sk-secret");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
      await adapter.close();
    }
  });

  it("resolves logical bindings from persisted ExecutionRequest bindings", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "model-text-agent.ts");
    const artifact = await fs.readFile(path.join(root, "model-text-agent.ts"));
    const seen: string[] = [];
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
      modelGateway: {
        async generateText(request) {
          seen.push(request.modelProfileVersionId);
          return { text: "normalized from gateway" };
        },
      },
    });

    try {
      const result = await adapter.execute(
        createTrustedRequest({
          timeoutMs: 5_000,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "model-text-agent.ts",
            integrity: sha256IntegrityOf(artifact),
          },
          modelProfileVersionBindings: modelBindings({
            primary: "mpv-frozen",
          }),
        }),
      );
      expect(result).toEqual({
        status: "succeeded",
        output: { text: "normalized from gateway" },
      });
      expect(seen).toEqual(["mpv-frozen"]);
    } finally {
      await adapter.close();
    }
  });

  it("does not re-resolve model bindings from AgentVersion at runtime", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "model-text-agent.ts");
    const artifact = await fs.readFile(path.join(root, "model-text-agent.ts"));
    const seen: string[] = [];
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
      modelGateway: {
        async generateText(request) {
          seen.push(request.modelProfileVersionId);
          return { text: "from frozen binding" };
        },
      },
    });

    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "model-text-agent.ts",
            integrity: sha256IntegrityOf(artifact),
          },
          modelProfileVersionBindings: modelBindings({
            primary: "mpv-run-snapshot",
          }),
        }),
      );
      expect(result.status).toBe("succeeded");
      expect(seen).toEqual(["mpv-run-snapshot"]);
      expect(seen).not.toContain("mpv-latest");
    } finally {
      await adapter.close();
    }
  });

  it("returns MODEL_BINDING_NOT_FOUND for an unknown logical binding", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "model-uncaught-agent.ts");
    const { adapter, request } = await adapterFor(
      root,
      "model-uncaught-agent.ts",
    );

    try {
      const result = await adapter.execute(request);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "MODEL_BINDING_NOT_FOUND" },
      });
    } finally {
      await adapter.close();
    }
  });

  it("lets an agent catch a model capability error and still succeed", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "model-catch-agent.ts");
    const { adapter, request } = await adapterFor(root, "model-catch-agent.ts");

    try {
      const result = await adapter.execute(request);
      expect(result).toEqual({
        status: "succeeded",
        output: {
          caught: true,
          code: "MODEL_BINDING_NOT_FOUND",
          ok: true,
        },
      });
    } finally {
      await adapter.close();
    }
  });

  it("invokes a bound internal tool through context.tools.invoke", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "tool-echo-agent.ts");
    const artifact = await fs.readFile(path.join(root, "tool-echo-agent.ts"));
    const seen: Array<{
      readonly toolVersionId: string;
      readonly input: unknown;
    }> = [];
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
      toolGateway: {
        async invoke(request) {
          seen.push({
            toolVersionId: request.toolVersionId,
            input: request.input,
          });
          if (
            request.input === null ||
            typeof request.input !== "object" ||
            Array.isArray(request.input)
          ) {
            throw new Error("Tool input must be an object.");
          }

          const record = request.input as Record<string, unknown>;
          if (!("value" in record) || !isCanonicalJsonValue(record.value)) {
            throw new Error("Tool input must include a JSON-compatible value.");
          }

          return { value: record.value };
        },
      },
    });

    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "tool-echo-agent.ts",
            integrity: sha256IntegrityOf(artifact),
          },
          input: { hello: "tool" },
          toolVersionBindings: toolBindings({ echo: "tv-frozen" }),
        }),
      );
      expect(result).toEqual({
        status: "succeeded",
        output: {
          echoed: { hello: "tool" },
          toolResult: { value: { hello: "tool" } },
          contextKeys: [
            "agentId",
            "agentVersionId",
            "input",
            "memory",
            "models",
            "runAttemptId",
            "runId",
            "tools",
            "workspaceId",
          ],
          hasToolVersionId: false,
          hasImplementationId: false,
        },
      });
      expect(seen).toEqual([
        { toolVersionId: "tv-frozen", input: { value: { hello: "tool" } } },
      ]);
    } finally {
      await adapter.close();
    }
  });

  it("returns TOOL_BINDING_NOT_FOUND for an unknown logical tool binding", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "tool-catch-agent.ts");
    const { adapter, request } = await adapterFor(root, "tool-catch-agent.ts");

    try {
      const result = await adapter.execute({
        ...request,
        toolVersionBindings: toolBindings({}),
      });
      expect(result).toEqual({
        status: "succeeded",
        output: {
          caught: true,
          code: "TOOL_BINDING_NOT_FOUND",
          ok: true,
        },
      });
    } finally {
      await adapter.close();
    }
  });

  it("does not derive tool idempotencyKey from RunAttemptId", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "tool-idempotency-agent.ts");
    const artifact = await fs.readFile(
      path.join(root, "tool-idempotency-agent.ts"),
    );
    const seenKeys: Array<string | undefined> = [];
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
      toolGateway: {
        async invoke(request) {
          seenKeys.push(request.idempotencyKey);
          return { value: true };
        },
      },
    });

    try {
      const result = await adapter.execute(
        createTrustedRequest({
          runAttemptId:
            "run-attempt-fixed" as import("@osva/contracts").RunAttemptId,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "tool-idempotency-agent.ts",
            integrity: sha256IntegrityOf(artifact),
          },
          toolVersionBindings: toolBindings({ echo: "tv-frozen" }),
        }),
      );
      expect(result.status).toBe("succeeded");
      expect(seenKeys).toEqual(["caller-supplied-key"]);
      expect(seenKeys[0]).not.toBe("run-attempt-fixed");
    } finally {
      await adapter.close();
    }
  });

  it("aborts outstanding provider calls when the child times out", async () => {
    const root = await createTrustedRoot();
    await installFixture(root, "model-hang-agent.ts");
    const artifact = await fs.readFile(path.join(root, "model-hang-agent.ts"));
    let aborted = false;
    let releaseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const adapter = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot: root,
      modelGateway: {
        generateText(_request, options) {
          releaseStarted?.();
          return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          });
        },
      },
    });

    try {
      const pending = adapter.execute(
        createTrustedRequest({
          timeoutMs: 2_000,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "model-hang-agent.ts",
            integrity: sha256IntegrityOf(artifact),
          },
          modelProfileVersionBindings: modelBindings({
            primary: "mpv-hang",
          }),
        }),
      );
      await started;
      const result = await pending;
      expect(result).toMatchObject({
        status: "failed",
        error: { code: RuntimeErrorCode.TIMEOUT },
      });
      expect(aborted).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});
