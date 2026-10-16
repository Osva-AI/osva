export interface HelloTimingReport {
  readonly environmentReadyMs: number;
  readonly agentRegistrationMs: number;
  readonly runSubmissionMs: number;
  readonly runToTerminalMs: number;
  readonly totalMs: number;
  readonly developerCommandCount: number;
}

export class HelloTimer {
  private readonly started = performance.now();
  private environmentReadyMs = 0;
  private agentRegistrationMs = 0;
  private runSubmissionMs = 0;
  private runToTerminalMs = 0;
  private readonly developerCommandCount: number;

  constructor(developerCommandCount: number) {
    this.developerCommandCount = developerCommandCount;
  }

  markEnvironmentReady(): void {
    this.environmentReadyMs = performance.now() - this.started;
  }

  markAgentRegistrationComplete(): void {
    this.agentRegistrationMs = performance.now() - this.started;
  }

  markRunSubmitted(): void {
    this.runSubmissionMs = performance.now() - this.started;
  }

  markRunTerminal(): void {
    this.runToTerminalMs = performance.now() - this.started;
  }

  report(): HelloTimingReport {
    return {
      environmentReadyMs: this.environmentReadyMs,
      agentRegistrationMs: this.agentRegistrationMs,
      runSubmissionMs: this.runSubmissionMs,
      runToTerminalMs: this.runToTerminalMs,
      totalMs: performance.now() - this.started,
      developerCommandCount: this.developerCommandCount,
    };
  }
}
