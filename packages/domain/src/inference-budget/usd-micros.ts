export class InvalidUsdMicrosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsdMicrosError";
  }
}

export function assertSafeUsdMicros(
  value: number,
  label = "usdMicros",
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidUsdMicrosError(`${label} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new InvalidUsdMicrosError(
      `${label} must be an integer micro-USD value`,
    );
  }
  if (value < 0) {
    throw new InvalidUsdMicrosError(`${label} must be non-negative`);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new InvalidUsdMicrosError(`${label} exceeds MAX_SAFE_INTEGER`);
  }
  return value;
}

export function addUsdMicros(left: number, right: number): number {
  const sum =
    assertSafeUsdMicros(left, "left") + assertSafeUsdMicros(right, "right");
  return assertSafeUsdMicros(sum, "sum");
}

export function subtractUsdMicros(left: number, right: number): number {
  const diff =
    assertSafeUsdMicros(left, "left") - assertSafeUsdMicros(right, "right");
  return assertSafeUsdMicros(diff, "difference");
}
