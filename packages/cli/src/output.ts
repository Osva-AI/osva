export function printResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      process.stdout.write(`${formatHuman(item)}\n`);
    }
    return;
  }

  process.stdout.write(`${formatHuman(value)}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatHuman(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
