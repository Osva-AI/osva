import { redactSecrets } from "./redact.js";

/**
 * Max overlap retained so secrets split across stream chunks are still matched.
 * Must exceed longest expected installation secret (64-hex) plus assignment prefix.
 */
export const STREAM_REDACT_OVERLAP_CHARS = 512;

export interface StreamingSecretRedactor {
  write(chunk: string): void;
  flush(): void;
}

export function createStreamingSecretRedactor(
  writeSafe: (text: string) => void,
  overlapChars: number = STREAM_REDACT_OVERLAP_CHARS,
): StreamingSecretRedactor {
  let pending = "";

  return {
    write(chunk: string): void {
      pending += chunk;
      if (pending.length <= overlapChars) {
        return;
      }
      const emitLength = pending.length - overlapChars;
      const emitPortion = redactSecrets(pending.slice(0, emitLength));
      writeSafe(emitPortion);
      pending = pending.slice(emitLength);
    },
    flush(): void {
      if (pending.length === 0) {
        return;
      }
      writeSafe(redactSecrets(pending));
      pending = "";
    },
  };
}
