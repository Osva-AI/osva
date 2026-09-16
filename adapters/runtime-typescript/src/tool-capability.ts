import { randomUUID } from "node:crypto";

import type { JsonValue } from "@osva/contracts";

import { ToolErrorCode, isToolBindingName } from "./constants.js";
import {
  isParentToChildToolMessage,
  type ToolInvokeRequestMessage,
} from "./protocol.js";

export class ToolCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolCapabilityError";
    this.code = code;
  }
}

export interface ToolInvokeOptions {
  readonly idempotencyKey?: string;
}

export interface TrustedAgentTools {
  invoke(
    binding: string,
    input: unknown,
    options?: ToolInvokeOptions,
  ): Promise<JsonValue>;
}

export function createTrustedAgentTools(): TrustedAgentTools {
  const pending = new Map<
    string,
    {
      readonly resolve: (output: JsonValue) => void;
      readonly reject: (error: ToolCapabilityError) => void;
    }
  >();

  process.on("message", (raw: unknown) => {
    if (!isParentToChildToolMessage(raw)) {
      return;
    }

    const waiter = pending.get(raw.callId);
    if (waiter === undefined) {
      return;
    }

    pending.delete(raw.callId);
    if (raw.type === "tool.invoke.succeeded") {
      waiter.resolve(raw.output);
      return;
    }

    waiter.reject(new ToolCapabilityError(raw.error.code, raw.error.message));
  });

  return {
    invoke(binding, input, options) {
      return new Promise((resolve, reject) => {
        if (!isToolBindingName(binding)) {
          reject(
            new ToolCapabilityError(
              ToolErrorCode.TOOL_BINDING_NOT_FOUND,
              "Tool binding was not found.",
            ),
          );
          return;
        }

        if (typeof process.send !== "function") {
          reject(
            new ToolCapabilityError(
              ToolErrorCode.TOOL_EXECUTION_ERROR,
              "Tool capability is unavailable.",
            ),
          );
          return;
        }

        const callId = randomUUID();
        const message: ToolInvokeRequestMessage =
          options?.idempotencyKey === undefined
            ? {
                v: 1,
                type: "tool.invoke.request",
                callId,
                binding,
                input,
              }
            : {
                v: 1,
                type: "tool.invoke.request",
                callId,
                binding,
                input,
                idempotencyKey: options.idempotencyKey,
              };

        pending.set(callId, { resolve, reject });
        const sent = process.send(message);
        if (!sent) {
          pending.delete(callId);
          reject(
            new ToolCapabilityError(
              ToolErrorCode.TOOL_EXECUTION_ERROR,
              "Tool capability is unavailable.",
            ),
          );
        }
      });
    },
  };
}
