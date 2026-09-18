import type {
  ContainerEngine,
  ContainerEngineContainer,
  ContainerEngineExecutionResult,
  ContainerEngineImageRef,
  CreateContainerOptions,
  RunContainerExecutionOptions,
} from "../src/container-engine.js";

export class FakeContainerEngine implements ContainerEngine {
  calls: string[] = [];

  resetCalls(): void {
    this.calls = [];
  }
  ensureImageImpl: (image: ContainerEngineImageRef) => Promise<void> =
    async () => {};
  createContainerImpl: (
    options: CreateContainerOptions,
  ) => Promise<ContainerEngineContainer> = async () => ({ id: "container-1" });
  startContainerImpl: (container: ContainerEngineContainer) => Promise<void> =
    async () => {};
  runProtocolExecutionImpl: (
    container: ContainerEngineContainer,
    options: RunContainerExecutionOptions,
  ) => Promise<ContainerEngineExecutionResult> = async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  stopContainerImpl: (container: ContainerEngineContainer) => Promise<void> =
    async () => {};
  killContainerImpl: (container: ContainerEngineContainer) => Promise<void> =
    async () => {};
  removeContainerImpl: (container: ContainerEngineContainer) => Promise<void> =
    async () => {};
  findExecutionContainerImpl: (
    executionId: string,
  ) => Promise<ContainerEngineContainer | undefined> = async () => undefined;

  async ensureImage(image: ContainerEngineImageRef): Promise<void> {
    this.calls.push("ensureImage");
    await this.ensureImageImpl(image);
  }

  async createContainer(
    options: CreateContainerOptions,
  ): Promise<ContainerEngineContainer> {
    this.calls.push("createContainer");
    return this.createContainerImpl(options);
  }

  async startContainer(container: ContainerEngineContainer): Promise<void> {
    this.calls.push("startContainer");
    await this.startContainerImpl(container);
  }

  async runProtocolExecution(
    container: ContainerEngineContainer,
    options: RunContainerExecutionOptions,
  ): Promise<ContainerEngineExecutionResult> {
    this.calls.push("runProtocolExecution");
    return this.runProtocolExecutionImpl(container, options);
  }

  async stopContainer(container: ContainerEngineContainer): Promise<void> {
    this.calls.push("stopContainer");
    await this.stopContainerImpl(container);
  }

  async killContainer(container: ContainerEngineContainer): Promise<void> {
    this.calls.push("killContainer");
    await this.killContainerImpl(container);
  }

  async removeContainer(container: ContainerEngineContainer): Promise<void> {
    this.calls.push("removeContainer");
    await this.removeContainerImpl(container);
  }

  async findExecutionContainer(
    executionId: string,
  ): Promise<ContainerEngineContainer | undefined> {
    this.calls.push(`findExecutionContainer:${executionId}`);
    return this.findExecutionContainerImpl(executionId);
  }
}
