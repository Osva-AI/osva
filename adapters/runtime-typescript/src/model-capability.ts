import { randomUUID } from "node:crypto";

import type { GenerateTextInput, GenerateTextResult } from "@osva/contracts";

import { ModelErrorCode, isModelBindingName } from "./constants.js";

import {
  isParentToChildModelMessage,
  type ModelGenerateRequestMessage,
} from "./protocol.js";

export class ModelCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelCapabilityError";
    this.code = code;
  }
}

export interface TrustedAgentModels {
  generateText(
    binding: string,
    request: GenerateTextInput,
  ): Promise<GenerateTextResult>;
}

export function createTrustedAgentModels(): TrustedAgentModels {
  const pending = new Map<
    string,
    {
      readonly resolve: (result: GenerateTextResult) => void;
      readonly reject: (error: ModelCapabilityError) => void;
    }
  >();

  process.on("message", (raw: unknown) => {
    if (!isParentToChildModelMessage(raw)) {
      return;
    }

    const waiter = pending.get(raw.callId);
    if (waiter === undefined) {
      return;
    }

    pending.delete(raw.callId);
    if (raw.type === "model.generate.succeeded") {
      waiter.resolve(raw.result);
      return;
    }

    waiter.reject(new ModelCapabilityError(raw.error.code, raw.error.message));
  });

  return {
    generateText(binding, request) {
      return new Promise((resolve, reject) => {
        if (!isModelBindingName(binding)) {
          reject(
            new ModelCapabilityError(
              ModelErrorCode.MODEL_BINDING_NOT_FOUND,
              "Model binding was not found.",
            ),
          );
          return;
        }

        if (typeof process.send !== "function") {
          reject(
            new ModelCapabilityError(
              ModelErrorCode.MODEL_PROVIDER_ERROR,
              "Model capability is unavailable.",
            ),
          );
          return;
        }

        const callId = randomUUID();
        const message: ModelGenerateRequestMessage = {
          v: 1,
          type: "model.generate.request",
          callId,
          binding,
          request,
        };

        pending.set(callId, { resolve, reject });
        const sent = process.send(message);
        if (!sent) {
          pending.delete(callId);
          reject(
            new ModelCapabilityError(
              ModelErrorCode.MODEL_PROVIDER_ERROR,
              "Model capability is unavailable.",
            ),
          );
        }
      });
    },
  };
}
