import { RUN_ATTEMPT_STATES, RUN_STATES } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  PERSISTED_RUN_ATTEMPT_STATES,
  PERSISTED_RUN_STATES,
} from "../src/schema/states.js";

describe("persisted Stage 0 state columns", () => {
  it("keeps run status CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_RUN_STATES]).toEqual([...RUN_STATES]);
  });

  it("keeps run attempt status CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_RUN_ATTEMPT_STATES]).toEqual([...RUN_ATTEMPT_STATES]);
  });
});
