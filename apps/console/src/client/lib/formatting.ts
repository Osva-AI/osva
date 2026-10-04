export function formatTimestamp(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatDurationMs(
  startedAt: string | undefined,
  completedAt: string | undefined,
): string {
  if (startedAt === undefined) {
    return "—";
  }
  const start = Date.parse(startedAt);
  const end = completedAt === undefined ? Date.now() : Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "—";
  }
  const ms = end - start;
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

export function formatUsdMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) {
    return "Cost unavailable";
  }
  const dollars = micros / 1_000_000;
  return `$${dollars.toFixed(6)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
