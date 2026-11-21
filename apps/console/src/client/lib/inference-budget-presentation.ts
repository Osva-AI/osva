/** Parse a decimal USD string into integer micros without floating-point math. */
export function parseUsdInputToMicros(input: string): number | undefined {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    return undefined;
  }
  const [wholePart, frac = ""] = trimmed.split(".");
  if (wholePart === undefined || wholePart.length === 0) {
    return undefined;
  }
  const fracPadded = (frac + "000000").slice(0, 6);
  const micros = BigInt(wholePart) * 1_000_000n + BigInt(fracPadded);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(micros);
}

/** Display-only USD formatting from integer micros (authority remains micros). */
export function formatUsdMicrosForDisplay(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1_000_000);
  const frac = abs % 1_000_000;
  if (frac === 0) {
    return `${sign}$${whole.toLocaleString("en-US")}`;
  }
  const fracStr = String(frac).padStart(6, "0").replace(/0+$/, "");
  return `${sign}$${whole.toLocaleString("en-US")}.${fracStr}`;
}

export function derivePreviousUtcPeriodKey(
  periodKey: string,
): string | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (match === null) {
    return undefined;
  }
  let year = Number(match[1]);
  let month = Number(match[2]);
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${String(year)}-${String(month).padStart(2, "0")}`;
}

export const INFERENCE_BUDGET_LIABILITY_DISCLAIMER =
  "Figures are OSVA estimated reservation liability, not guaranteed provider invoices or a billing ceiling.";
