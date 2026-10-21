import type { WorkflowDefinitionWaitConfigurationV3 } from "@osva-ai/contracts";
import { isValidUtcIso8601Instant } from "@osva-ai/contracts";

export function durationMsToMinutes(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 60_000));
}

export function minutesToDurationMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 60_000;
  }
  return Math.round(minutes * 60_000);
}

export function describeWaitConfiguration(
  wait: WorkflowDefinitionWaitConfigurationV3,
): string {
  if (wait.kind === "DURATION") {
    const minutes = durationMsToMinutes(wait.durationMs);
    return `Wait ${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  }
  if (wait.kind === "UNTIL") {
    return `Wait until ${wait.until}`;
  }
  return `Wait for event ${wait.source}/${wait.eventType}`;
}

export function localDatetimeInputValueFromUtcIso(until: string): string {
  if (!isValidUtcIso8601Instant(until)) {
    return "";
  }
  const date = new Date(until);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function utcIsoFromLocalDatetimeInput(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const iso = parsed.toISOString();
  return isValidUtcIso8601Instant(iso) ? iso : undefined;
}
