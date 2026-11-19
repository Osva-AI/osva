import { TextEncoder } from "node:util";

import type {
  RunId,
  RunLiveStreamPublisher,
  RunLiveStreamViewerEnvelope,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  RUN_LIVE_STREAM_MAX_PUBLISH_BYTES,
  runLiveStreamChannelName,
} from "@osva-ai/contracts";
import { runLiveStreamViewerEnvelopeSchema } from "@osva-ai/contracts/schemas";
import { Redis, type RedisOptions } from "ioredis";

const encoder = new TextEncoder();

export interface ValkeyRunLiveStreamOptions {
  readonly url: string;
  readonly redisOptions?: RedisOptions;
  readonly onPublishError?: (error: unknown) => void;
}

/**
 * Ephemeral Valkey Pub/Sub fan-out for live Run viewers. No replay; subscribers
 * may miss messages while disconnected.
 */
export class ValkeyRunLiveStreamPublisher implements RunLiveStreamPublisher {
  private readonly client: Redis;

  constructor(options: ValkeyRunLiveStreamOptions) {
    this.client = new Redis(options.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      ...options.redisOptions,
    });
    this.onPublishError = options.onPublishError;
  }

  private readonly onPublishError?: (error: unknown) => void;

  tryPublish(envelope: RunLiveStreamViewerEnvelope): void {
    const parsed = runLiveStreamViewerEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      return;
    }

    const payload = JSON.stringify(parsed.data);
    if (encoder.encode(payload).length > RUN_LIVE_STREAM_MAX_PUBLISH_BYTES) {
      return;
    }

    const channel = runLiveStreamChannelName(
      parsed.data.workspaceId,
      parsed.data.runId,
    );

    void this.client
      .publish(channel, payload)
      .catch((error) => this.onPublishError?.(error));
  }

  async connect(): Promise<void> {
    if (this.client.status === "wait") {
      await this.client.connect();
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export interface ValkeyRunLiveStreamSubscriptionOptions {
  readonly url: string;
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly onEnvelope: (envelope: RunLiveStreamViewerEnvelope) => void;
  readonly onError?: (error: unknown) => void;
  readonly redisOptions?: RedisOptions;
}

export class ValkeyRunLiveStreamSubscription {
  private readonly subscriber: Redis;
  private readonly channel: string;
  private active = false;
  private readonly ready: Promise<void>;
  private readyResolve: (() => void) | undefined;

  constructor(
    private readonly options: ValkeyRunLiveStreamSubscriptionOptions,
  ) {
    this.subscriber = new Redis(options.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      ...options.redisOptions,
    });
    this.channel = runLiveStreamChannelName(options.workspaceId, options.runId);
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    await this.subscriber.connect();
    await this.subscriber.subscribe(this.channel);
    this.readyResolve?.();
    this.readyResolve = undefined;
    this.subscriber.on("message", (channel, message) => {
      if (channel !== this.channel) {
        return;
      }
      try {
        const raw: unknown = JSON.parse(message);
        const parsed = runLiveStreamViewerEnvelopeSchema.safeParse(raw);
        if (!parsed.success) {
          return;
        }
        if (parsed.data.workspaceId !== this.options.workspaceId) {
          return;
        }
        if (parsed.data.runId !== this.options.runId) {
          return;
        }
        this.options.onEnvelope(parsed.data);
      } catch (error) {
        this.options.onError?.(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.subscriber.removeAllListeners("message");
    await this.subscriber.unsubscribe(this.channel);
    await this.subscriber.quit();
  }
}
