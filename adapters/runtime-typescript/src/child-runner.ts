import { pathToFileURL } from "node:url";

import { RuntimeErrorCode, TRUSTED_AGENT_EXPORT_NAME } from "./constants.js";
import { deepFreezeChildValue, isChildJsonValue } from "./child-json.js";
import {
  createTrustedAgentModels,
  ModelCapabilityError,
} from "./model-capability.js";
import { isExecuteChildRequest } from "./protocol.js";
import { sanitizePublicErrorMessage } from "./public-error.js";

process.on("message", (raw: unknown) => {
  if (isExecuteChildRequest(raw)) {
    void handle(raw);
  }
});

async function handle(raw: unknown): Promise<void> {
  if (!isExecuteChildRequest(raw)) {
    sendFailure(
      RuntimeErrorCode.INVALID_MODULE,
      "Trusted runtime received an invalid execution request.",
    );
    return;
  }

  try {
    const moduleUrl = pathToFileURL(raw.modulePath).href;
    const loaded: unknown = await import(moduleUrl);
    const run = getRunExport(loaded);
    if (run === undefined) {
      sendFailure(
        RuntimeErrorCode.INVALID_MODULE,
        "Trusted runtime module must export an async function named run.",
      );
      return;
    }

    const context = deepFreezeChildValue({
      ...raw.context,
      models: createTrustedAgentModels(),
    });
    const output: unknown = await run(context);
    if (!isChildJsonValue(output)) {
      sendFailure(
        RuntimeErrorCode.INVALID_OUTPUT,
        "Trusted runtime output is not JSON-compatible.",
      );
      return;
    }

    send({
      v: 1,
      type: "succeeded",
      output,
    });
  } catch (error) {
    if (error instanceof ModelCapabilityError) {
      sendFailure(error.code, error.message);
      return;
    }

    sendFailure(
      RuntimeErrorCode.AGENT_ERROR,
      error instanceof Error
        ? sanitizePublicErrorMessage(
            error.message,
            "Trusted agent execution failed.",
          )
        : "Trusted agent execution failed.",
    );
  }
}

function getRunExport(
  loaded: unknown,
): ((context: unknown) => Promise<unknown> | unknown) | undefined {
  if (loaded === null || typeof loaded !== "object") {
    return undefined;
  }

  const candidate = (loaded as Record<string, unknown>)[
    TRUSTED_AGENT_EXPORT_NAME
  ];
  if (typeof candidate !== "function") {
    return undefined;
  }

  return candidate as (context: unknown) => Promise<unknown> | unknown;
}

function sendFailure(code: string, message: string): void {
  send({
    v: 1,
    type: "failed",
    error: { code, message },
  });
}

function send(message: unknown): void {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }

  process.send(message);
}
