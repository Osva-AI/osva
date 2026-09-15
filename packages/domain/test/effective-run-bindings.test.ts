import type { ModelProfileVersionId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { EffectiveRunBindings } from "../src/effective-run-bindings.js";
import { agentVersionId, modelProfileVersionId } from "./fixtures.js";

describe("EffectiveRunBindings immutability", () => {
  it("cannot mutate the model binding map after construction", () => {
    const input: Record<string, ModelProfileVersionId> = {
      default: modelProfileVersionId,
    };
    const bindings = EffectiveRunBindings.create({
      agentVersionId,
      modelProfileVersionBindings: input,
      toolVersionBindings: {},
    });

    input.other = "model-profile-version-2" as ModelProfileVersionId;

    expect(bindings.modelProfileVersionBindings).toEqual({
      default: modelProfileVersionId,
    });
    expect(Object.isFrozen(bindings)).toBe(true);
    expect(Object.isFrozen(bindings.modelProfileVersionBindings)).toBe(true);

    expect(() => {
      (
        bindings.modelProfileVersionBindings as Record<
          string,
          ModelProfileVersionId
        >
      ).other = "model-profile-version-2" as ModelProfileVersionId;
    }).toThrow(TypeError);

    expect(() => {
      delete (
        bindings.modelProfileVersionBindings as Record<
          string,
          ModelProfileVersionId
        >
      ).default;
    }).toThrow(TypeError);

    expect(bindings.modelProfileVersionBindings.default).toBe(
      modelProfileVersionId,
    );
    expect(bindings.modelProfileVersionBindings.other).toBeUndefined();
  });
});
