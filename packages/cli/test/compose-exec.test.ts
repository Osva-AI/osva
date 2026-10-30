import { describe, expect, it } from "vitest";

import {
  buildComposeSpawnEnv,
  composeBaseArgs,
  runComposeCommand,
} from "../src/setup/compose-exec.js";

describe("compose exec", () => {
  it("passes compose project env and name to docker subprocesses", () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const ctx = {
      installDir: "/tmp/osva-install",
      envFilePath: "/tmp/osva-install/.env",
      projectName: "osva-deadbeef0123",
    };
    runComposeCommand(ctx, ["ps"], {
      timeoutMs: 1_000,
      processEnv: buildComposeSpawnEnv(ctx, {
        ...process.env,
        COMPOSE_PROJECT_NAME: "wrong-project",
      }),
      spawn: (_executable, args, _timeoutMs, processEnv) => {
        capturedEnv = processEnv;
        expect(args.join(" ")).toContain("--project-name");
        expect(args.join(" ")).toContain("osva-deadbeef0123");
        return { status: 0, stdout: "", stderr: "", error: undefined };
      },
    });
    expect(capturedEnv?.COMPOSE_PROJECT_NAME).toBe("osva-deadbeef0123");
  });

  it("includes project directory and env file in base args", () => {
    const args = composeBaseArgs({
      installDir: "C:\\osva\\install",
      envFilePath: "C:\\osva\\install\\.env",
      projectName: "osva-test",
    });
    expect(args).toContain("--project-name");
    expect(args).toContain("osva-test");
    expect(args.join(" ")).toContain("C:\\osva\\install");
  });
});
