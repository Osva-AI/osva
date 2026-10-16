import { describe, expect, it } from "vitest";

import {
  runSubprocess,
  SubprocessStartError,
  SubprocessTimeoutError,
  terminateTrackedSubprocesses,
} from "./run-cli-subprocess.js";

describe("run-cli subprocess harness", () => {
  it("resolves when the child exits promptly", async () => {
    const result = await runSubprocess(
      process.execPath,
      ["-e", "process.stdout.write('ok\\n');"],
      { timeoutMs: 5_000 },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok\n");
    expect(result.stderr).toBe("");
  });

  it("terminates a hung child and rejects with stderr preserved", async () => {
    await expect(
      runSubprocess(
        process.execPath,
        ["-e", "setTimeout(() => {}, 2 ** 30);"],
        { timeoutMs: 800 },
      ),
    ).rejects.toBeInstanceOf(SubprocessTimeoutError);

    await terminateTrackedSubprocesses();
  });

  it("surfaces spawn failures separately from timeouts", async () => {
    await expect(
      runSubprocess("definitely-not-an-executable-xyz", [], {
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(SubprocessStartError);
  });
});
