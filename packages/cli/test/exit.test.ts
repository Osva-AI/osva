import { afterEach, describe, expect, it, vi } from "vitest";

import { exitCli } from "../src/exit.js";

describe("exitCli", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("sets process.exitCode and does not call process.exit", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    await exitCli(1);
    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
