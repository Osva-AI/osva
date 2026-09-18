import {
  ContainerRuntimeAdapter,
  createDockerodeClient,
  DEFAULT_CONTAINER_RESOURCE_POLICY,
  DockerEngineAdapter,
} from "@osva/adapters-runtime-container";
import {
  ProcessEnvSecretResolver,
  RemoteHttpRuntimeAdapter,
  type RuntimeExecutionBootstrapStore,
} from "@osva/adapters-runtime-http";
import { TrustedTypeScriptRuntimeAdapter } from "@osva/adapters-runtime-typescript";
import type { AgentRuntimeType, RuntimeAdapter } from "@osva/contracts";

import type { WorkerConfig } from "./config.js";

export interface TrustedRuntimeComposition {
  readonly trustedRuntimeRoot: string;
  readonly trustedAdapter: TrustedTypeScriptRuntimeAdapter;
}

export interface RemoteHttpRuntimeComposition {
  readonly getCapabilityBaseUrl: () => string | undefined;
  readonly capabilitySecret: string;
  readonly allowPrivateNetworks: boolean;
  readonly clock: { now(): Date };
  readonly logger?: {
    info(event: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, error: unknown): void;
  };
}

export interface ContainerRuntimeComposition {
  readonly getCapabilityBaseUrl: () => string | undefined;
  readonly capabilitySecret: string;
  readonly executionBootstrap: RuntimeExecutionBootstrapStore;
  readonly clock: { now(): Date };
  readonly logger?: {
    info(event: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, error: unknown): void;
  };
}

export interface ComposeRuntimeExecutorsOptions {
  readonly config: WorkerConfig;
  readonly trusted: TrustedRuntimeComposition;
  readonly remoteHttp: RemoteHttpRuntimeComposition;
  readonly container?: ContainerRuntimeComposition;
  readonly secretResolver?: ProcessEnvSecretResolver;
}

export function composeRuntimeExecutors(
  options: ComposeRuntimeExecutorsOptions,
): Partial<Record<AgentRuntimeType, RuntimeAdapter>> {
  const secretResolver =
    options.secretResolver ?? new ProcessEnvSecretResolver(process.env);

  const executors: Partial<Record<AgentRuntimeType, RuntimeAdapter>> = {
    TRUSTED_TYPESCRIPT: options.trusted.trustedAdapter,
    REMOTE_HTTP: new RemoteHttpRuntimeAdapter({
      secretResolver,
      getCapabilityBaseUrl: options.remoteHttp.getCapabilityBaseUrl,
      capabilitySecret: options.remoteHttp.capabilitySecret,
      allowPrivateNetworks: options.remoteHttp.allowPrivateNetworks,
      clock: options.remoteHttp.clock,
      logger: options.remoteHttp.logger,
    }),
  };

  if (options.config.containerEnabled && options.container !== undefined) {
    executors.CONTAINER = new ContainerRuntimeAdapter({
      engine: new DockerEngineAdapter({
        client: createDockerodeClient(),
        network: { networkMode: options.config.containerNetworkMode },
      }),
      resourcePolicy:
        options.config.containerResourcePolicy ??
        DEFAULT_CONTAINER_RESOURCE_POLICY,
      getCapabilityBaseUrl: options.container.getCapabilityBaseUrl,
      capabilitySecret: options.container.capabilitySecret,
      executionBootstrap: options.container.executionBootstrap,
      clock: options.container.clock,
      logger: options.container.logger,
    });
  }

  return executors;
}
