import { randomUUID } from "node:crypto";
import {
  PassThrough,
  Readable,
  type Readable as ReadableStream,
} from "node:stream";

import type { JsonObject } from "@osva/contracts";

import {
  ArtifactErrorCode,
  TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES,
} from "./constants.js";
import {
  isParentToChildArtifactCreateMessage,
  isParentToChildArtifactGetMessage,
  isParentToChildArtifactOpenMessage,
  type ArtifactCreateRequestMessage,
  type ArtifactGetRequestMessage,
  type ArtifactOpenRequestMessage,
  type RuntimeArtifactViewMessage,
} from "./protocol.js";

export class ArtifactCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArtifactCapabilityError";
    this.code = code;
  }
}

export interface CreateArtifactOptions {
  readonly name: string;
  readonly mediaType?: string;
  readonly metadata?: JsonObject;
  readonly idempotencyKey?: string;
  readonly expectedDigest?: string;
}

export interface TrustedAgentArtifacts {
  create(
    name: string,
    content: ReadableStream,
    options?: Omit<CreateArtifactOptions, "name">,
  ): Promise<RuntimeArtifactViewMessage>;
  get(artifactId: string): Promise<RuntimeArtifactViewMessage>;
  open(artifactId: string): Promise<{
    readonly artifact: RuntimeArtifactViewMessage;
    readonly stream: Readable;
  }>;
}

export function createTrustedAgentArtifacts(): TrustedAgentArtifacts {
  const pendingGets = createPendingMap<RuntimeArtifactViewMessage>();
  const pendingCreates = createPendingMap<RuntimeArtifactViewMessage>();
  const pendingOpens = createPendingMap<{
    readonly artifact: RuntimeArtifactViewMessage;
    readonly stream: Readable;
  }>();

  process.on("message", (raw: unknown) => {
    if (isParentToChildArtifactGetMessage(raw)) {
      dispatchArtifactGet(pendingGets, raw);
      return;
    }

    if (isParentToChildArtifactCreateMessage(raw)) {
      dispatchArtifactCreate(pendingCreates, raw);
      return;
    }

    if (isParentToChildArtifactOpenMessage(raw)) {
      dispatchArtifactOpen(pendingOpens, raw);
    }
  });

  return {
    create(name, content, options) {
      return streamArtifactCreate(name, content, pendingCreates, options);
    },
    get(artifactId) {
      return requestArtifactGet(artifactId, pendingGets);
    },
    open(artifactId) {
      return requestArtifactOpen(artifactId, pendingOpens);
    },
  };
}

async function streamArtifactCreate(
  name: string,
  content: ReadableStream,
  pendingCreates: ReturnType<
    typeof createPendingMap<RuntimeArtifactViewMessage>
  >,
  options?: Omit<CreateArtifactOptions, "name">,
): Promise<RuntimeArtifactViewMessage> {
  if (typeof process.send !== "function") {
    throw new ArtifactCapabilityError(
      ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
      "Artifact capability is unavailable.",
    );
  }

  const callId = randomUUID();
  const pending = new Promise<RuntimeArtifactViewMessage>((resolve, reject) => {
    pendingCreates.set(callId, { resolve, reject });
  });

  const request: ArtifactCreateRequestMessage = {
    v: 1,
    type: "artifact.create.request",
    callId,
    name,
    ...(options?.mediaType === undefined
      ? {}
      : { mediaType: options.mediaType }),
    ...(options?.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options?.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
    ...(options?.expectedDigest === undefined
      ? {}
      : { expectedDigest: options.expectedDigest }),
  };

  if (!process.send(request)) {
    throw new ArtifactCapabilityError(
      ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
      "Artifact capability is unavailable.",
    );
  }

  try {
    for await (const chunk of content) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (
        let offset = 0;
        offset < buffer.length;
        offset += TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES
      ) {
        const slice = buffer.subarray(
          offset,
          offset + TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES,
        );
        if (
          !process.send({
            v: 1,
            type: "artifact.create.chunk",
            callId,
            chunk: slice.toString("base64"),
          })
        ) {
          throw new ArtifactCapabilityError(
            ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
            "Artifact capability is unavailable.",
          );
        }
      }
    }

    if (
      !process.send({
        v: 1,
        type: "artifact.create.end",
        callId,
      })
    ) {
      throw new ArtifactCapabilityError(
        ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
        "Artifact capability is unavailable.",
      );
    }
  } catch (error) {
    pendingCreates.delete(callId);
    if (error instanceof ArtifactCapabilityError) {
      throw error;
    }
    throw new ArtifactCapabilityError(
      ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
      "Artifact upload failed.",
    );
  }

  return pending;
}

function requestArtifactGet(
  artifactId: string,
  pending: ReturnType<typeof createPendingMap<RuntimeArtifactViewMessage>>,
): Promise<RuntimeArtifactViewMessage> {
  return requestSimple({
    unavailableCode: ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
    buildMessage: (callId): ArtifactGetRequestMessage => ({
      v: 1,
      type: "artifact.get.request",
      callId,
      artifactId,
    }),
    pending,
  });
}

function requestArtifactOpen(
  artifactId: string,
  pending: ReturnType<
    typeof createPendingMap<{
      readonly artifact: RuntimeArtifactViewMessage;
      readonly stream: Readable;
    }>
  >,
): Promise<{
  readonly artifact: RuntimeArtifactViewMessage;
  readonly stream: Readable;
}> {
  return requestSimple({
    unavailableCode: ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
    buildMessage: (callId): ArtifactOpenRequestMessage => ({
      v: 1,
      type: "artifact.open.request",
      callId,
      artifactId,
    }),
    pending,
  });
}

function requestSimple<T>(options: {
  readonly unavailableCode: string;
  readonly buildMessage: (callId: string) => unknown;
  readonly pending: Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: ArtifactCapabilityError) => void;
    }
  >;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(
        new ArtifactCapabilityError(
          options.unavailableCode,
          "Artifact capability is unavailable.",
        ),
      );
      return;
    }

    const callId = randomUUID();
    options.pending.set(callId, { resolve, reject });
    const sent = process.send(options.buildMessage(callId));
    if (!sent) {
      options.pending.delete(callId);
      reject(
        new ArtifactCapabilityError(
          options.unavailableCode,
          "Artifact capability is unavailable.",
        ),
      );
    }
  });
}

function createPendingMap<T>() {
  return new Map<
    string,
    {
      readonly resolve: (value: T) => void;
      readonly reject: (error: ArtifactCapabilityError) => void;
    }
  >();
}

function dispatchArtifactGet(
  pending: Map<
    string,
    {
      readonly resolve: (value: RuntimeArtifactViewMessage) => void;
      readonly reject: (error: ArtifactCapabilityError) => void;
    }
  >,
  raw: {
    readonly callId: string;
    readonly type: string;
    readonly artifact?: RuntimeArtifactViewMessage;
    readonly error?: { readonly code: string; readonly message: string };
  },
): void {
  const waiter = pending.get(raw.callId);
  if (waiter === undefined) {
    return;
  }

  pending.delete(raw.callId);
  if (raw.type === "artifact.get.succeeded" && raw.artifact !== undefined) {
    waiter.resolve(raw.artifact);
    return;
  }

  waiter.reject(
    new ArtifactCapabilityError(
      raw.error?.code ?? ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
      raw.error?.message ?? "Artifact get failed.",
    ),
  );
}

function dispatchArtifactCreate(
  pending: Map<
    string,
    {
      readonly resolve: (value: RuntimeArtifactViewMessage) => void;
      readonly reject: (error: ArtifactCapabilityError) => void;
    }
  >,
  raw: {
    readonly callId: string;
    readonly type: string;
    readonly artifact?: RuntimeArtifactViewMessage;
    readonly error?: { readonly code: string; readonly message: string };
  },
): void {
  const waiter = pending.get(raw.callId);
  if (waiter === undefined) {
    return;
  }

  pending.delete(raw.callId);
  if (raw.type === "artifact.create.succeeded" && raw.artifact !== undefined) {
    waiter.resolve(raw.artifact);
    return;
  }

  waiter.reject(
    new ArtifactCapabilityError(
      raw.error?.code ?? ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
      raw.error?.message ?? "Artifact create failed.",
    ),
  );
}

function dispatchArtifactOpen(
  pending: Map<
    string,
    {
      readonly resolve: (value: {
        readonly artifact: RuntimeArtifactViewMessage;
        readonly stream: Readable;
      }) => void;
      readonly reject: (error: ArtifactCapabilityError) => void;
    }
  >,
  raw: {
    readonly callId: string;
    readonly type: string;
    readonly artifact?: RuntimeArtifactViewMessage;
    readonly chunk?: string;
    readonly error?: { readonly code: string; readonly message: string };
  },
): void {
  if (raw.type === "artifact.open.meta" && raw.artifact !== undefined) {
    const stream = new PassThrough();
    openSessions.set(raw.callId, { stream, artifact: raw.artifact });
    return;
  }

  const state = openSessions.get(raw.callId);
  if (raw.type === "artifact.open.chunk" && typeof raw.chunk === "string") {
    state?.stream.write(Buffer.from(raw.chunk, "base64"));
    return;
  }

  if (raw.type === "artifact.open.end") {
    const session = openSessions.get(raw.callId);
    openSessions.delete(raw.callId);
    if (session === undefined) {
      return;
    }
    session.stream.end();
    const waiter = pending.get(raw.callId);
    if (waiter === undefined) {
      return;
    }
    pending.delete(raw.callId);
    waiter.resolve({
      artifact: session.artifact,
      stream: session.stream,
    });
    return;
  }

  if (raw.type === "artifact.open.failed") {
    openSessions.delete(raw.callId);
    const waiter = pending.get(raw.callId);
    if (waiter === undefined) {
      return;
    }
    pending.delete(raw.callId);
    waiter.reject(
      new ArtifactCapabilityError(
        raw.error?.code ?? ArtifactErrorCode.ARTIFACT_UNAVAILABLE,
        raw.error?.message ?? "Artifact open failed.",
      ),
    );
  }
}

const openSessions = new Map<
  string,
  {
    readonly stream: PassThrough;
    readonly artifact: RuntimeArtifactViewMessage;
  }
>();
