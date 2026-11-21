import { describe, expect, it, vi } from "vitest";

import { RuntimeErrorCode } from "../src/constants.js";
import { executionFailure } from "../src/public-error.js";
import {
  applyExecutionDeadlineToResult,
  drainCapabilityHandlersUntilDeadline,
  executionResultIsExecutionTimeout,
  preferTerminalExecutionResult,
} from "../src/trusted-typescript-runtime-adapter.js";

describe("capability handler drain", () => {
  it("preferTerminalExecutionResult preserves agent failure over execution timeout", () => {
    const agentFailure = executionFailure(
      RuntimeErrorCode.AGENT_ERROR,
      "agent failed",
    );
    const timeout = executionFailure(
      RuntimeErrorCode.TIMEOUT,
      "Trusted runtime execution timed out.",
    );
    expect(preferTerminalExecutionResult(agentFailure, timeout)).toBe(
      agentFailure,
    );
  });

  it("preferTerminalExecutionResult lets execution timeout override success", () => {
    const success = { status: "succeeded" as const, output: {} };
    const timeout = executionFailure(
      RuntimeErrorCode.TIMEOUT,
      "Trusted runtime execution timed out.",
    );
    expect(preferTerminalExecutionResult(success, timeout)).toEqual(timeout);
  });

  it("applyExecutionDeadlineToResult upgrades success when drain exceeds deadline", () => {
    const success = { status: "succeeded" as const, output: {} };
    const upgraded = applyExecutionDeadlineToResult(
      success,
      "deadline_exceeded",
      1,
    );
    expect(executionResultIsExecutionTimeout(upgraded)).toBe(true);
  });

  it("applyExecutionDeadlineToResult keeps agent failure when handlers remain", () => {
    const agentFailure = executionFailure(
      RuntimeErrorCode.AGENT_ERROR,
      "agent failed",
    );
    expect(
      applyExecutionDeadlineToResult(agentFailure, "deadline_exceeded", 2),
    ).toBe(agentFailure);
  });

  it("waits for handlers to settle before returning complete", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = gate.then(() => undefined);
    const handlers = new Set<Promise<void>>([handler]);

    const now = vi.fn();
    const start = 1_000;
    now.mockReturnValue(start);

    const sleep = vi.fn(() => Promise.resolve());

    const pending = drainCapabilityHandlersUntilDeadline({
      handlers,
      deadlineAt: start + 500,
      now,
      sleep,
    });

    expect(release).toBeDefined();
    release!();
    const drain = await pending;

    expect(drain.status).toBe("complete");
    expect(drain.outcomes).toHaveLength(1);
    expect(drain.outcomes[0]?.status).toBe("fulfilled");
  });

  it("observes rejected handlers without unhandled rejections", async () => {
    const rejected = Promise.reject(new Error("handler failed"));
    void rejected.catch(() => {
      /* observed */
    });
    const errors: unknown[] = [];
    const logger = {
      info: () => undefined,
      error: (_event: string, error: unknown) => {
        errors.push(error);
      },
    };

    const drain = await drainCapabilityHandlersUntilDeadline({
      handlers: new Set([rejected]),
      deadlineAt: Date.now() + 5_000,
      logger,
    });

    expect(drain.status).toBe("complete");
    expect(errors).toHaveLength(1);
  });

  it("returns deadline_exceeded when handlers remain past the execution deadline", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = gate.then(() => undefined);
    const handlers = new Set<Promise<void>>([handler]);

    const start = 10_000;
    let clock = start;
    const now = () => clock;
    const sleep = async (ms: number) => {
      clock += ms;
    };

    const drain = await drainCapabilityHandlersUntilDeadline({
      handlers,
      deadlineAt: start + 100,
      now,
      sleep,
    });

    expect(drain.status).toBe("deadline_exceeded");
    expect(drain.handlersRemaining).toBe(1);
    expect(release).toBeDefined();
    release!();
    await handler;
  });
});
