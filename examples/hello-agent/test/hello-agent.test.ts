import { describe, expect, it } from "vitest";

import { run } from "../agent/hello-agent.js";
import {
  HELLO_DEFAULT_INPUT,
  HELLO_EXPECTED_OUTPUT,
} from "../scripts/lib/constants.js";

describe("Hello Agent runtime contract", () => {
  it("echoes message deterministically", async () => {
    await expect(run({ input: HELLO_DEFAULT_INPUT })).resolves.toEqual(
      HELLO_EXPECTED_OUTPUT,
    );
  });

  it("rejects invalid input", async () => {
    await expect(run({ input: {} })).rejects.toThrow(/message/);
  });
});
