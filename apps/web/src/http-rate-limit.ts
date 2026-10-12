import type { IncomingMessage } from "node:http";
import type { RequestPrincipal } from "@osva-ai/contracts";
import {
  OSVA_AUTHENTICATED_RATE_LIMIT_PER_MINUTE,
  OSVA_RATE_LIMIT_WINDOW_SECONDS,
  OSVA_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE,
} from "@osva-ai/contracts";
import type { RateLimitConsumeResult } from "@osva/adapters-bullmq";
import { ValkeyUnavailableError } from "@osva/adapters-bullmq";

import { resolveRequestSourceIp } from "./client-ip.js";

export interface HttpRateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitConsumeResult>;
}

export interface HttpRateLimitContext {
  readonly limiter: HttpRateLimiter;
  readonly trustedProxies: readonly string[];
  readonly unauthenticatedPerMinute: number;
  readonly authenticatedPerMinute: number;
  readonly windowSeconds: number;
}

export type HttpRateLimitDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "throttled"; readonly retryAfterSeconds: number }
  | { readonly kind: "unavailable" };

export function defaultHttpRateLimitContext(
  limiter: HttpRateLimiter,
  options: {
    readonly trustedProxies?: readonly string[];
    readonly unauthenticatedPerMinute?: number;
    readonly authenticatedPerMinute?: number;
    readonly windowSeconds?: number;
  } = {},
): HttpRateLimitContext {
  return {
    limiter,
    trustedProxies: options.trustedProxies ?? [],
    unauthenticatedPerMinute:
      options.unauthenticatedPerMinute ??
      OSVA_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE,
    authenticatedPerMinute:
      options.authenticatedPerMinute ??
      OSVA_AUTHENTICATED_RATE_LIMIT_PER_MINUTE,
    windowSeconds: options.windowSeconds ?? OSVA_RATE_LIMIT_WINDOW_SECONDS,
  };
}

export async function consumeHttpRateLimit(
  request: IncomingMessage,
  principal: RequestPrincipal | undefined,
  context: HttpRateLimitContext,
): Promise<HttpRateLimitDecision> {
  const sourceIp = resolveRequestSourceIp(request, context.trustedProxies);
  const bucket =
    principal === undefined
      ? {
          key: `osva:rl:unauth:v1:${sourceIp}`,
          limit: context.unauthenticatedPerMinute,
        }
      : {
          key: `osva:rl:key:v1:${principal.workspaceId}:${principal.subjectId}`,
          limit: context.authenticatedPerMinute,
        };

  try {
    const result = await context.limiter.consume(
      bucket.key,
      bucket.limit,
      context.windowSeconds,
    );
    if (result.outcome === "throttled") {
      return {
        kind: "throttled",
        retryAfterSeconds: result.retryAfterSeconds,
      };
    }
    return { kind: "allowed" };
  } catch (error) {
    if (error instanceof ValkeyUnavailableError) {
      return { kind: "unavailable" };
    }
    return { kind: "unavailable" };
  }
}
