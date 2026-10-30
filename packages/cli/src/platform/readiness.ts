import { createFetchProbeTransport } from "../doctor/http-probe.js";
import { DEFAULT_PROBE_TIMEOUT_MS } from "../doctor/run-doctor.js";
import type { ResolvedInstallation } from "./types.js";

export interface ReadinessSnapshot {
  readonly apiHealthOk: boolean;
  readonly apiReadyOk: boolean;
  readonly consoleReady: boolean;
  readonly apiReadyDetail: string | undefined;
}

export async function probeInstallationReadiness(
  installation: ResolvedInstallation,
  fetchImpl: typeof fetch = fetch,
  probeTimeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ReadinessSnapshot> {
  const transport = createFetchProbeTransport(fetchImpl, probeTimeoutMs);
  const health = await transport.getJson(`${installation.webUrl}/health`);
  const apiHealthOk =
    health.kind === "ok" &&
    health.status === 200 &&
    isHealthOkBody(health.body);

  let apiReadyOk = false;
  let apiReadyDetail: string | undefined;
  const ready = await transport.getJson(`${installation.webUrl}/ready`);
  if (ready.kind === "ok" && ready.status === 200) {
    apiReadyOk = true;
  } else if (ready.kind === "ok" && ready.status === 503) {
    apiReadyDetail = readyFailureDetail(ready.body);
    apiReadyOk = false;
  } else if (ready.kind === "ok") {
    apiReadyDetail = `HTTP ${String(ready.status)}`;
  } else {
    apiReadyDetail = ready.kind === "timeout" ? "timed out" : "transport error";
  }

  let consoleReady = false;
  try {
    const response = await fetchImpl(`${installation.consoleUrl}/`, {
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    consoleReady = response.ok;
  } catch {
    consoleReady = false;
  }

  return { apiHealthOk, apiReadyOk, consoleReady, apiReadyDetail };
}

function isHealthOkBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    (body as { status?: unknown }).status === "ok"
  );
}

function readyFailureDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const failed = (body as { failedDependency?: unknown }).failedDependency;
  if (typeof failed === "string" && failed.length > 0) {
    return failed;
  }
  const failedMany = (body as { failedDependencies?: unknown })
    .failedDependencies;
  if (Array.isArray(failedMany) && failedMany.length > 0) {
    return failedMany.map(String).join(", ");
  }
  return undefined;
}
