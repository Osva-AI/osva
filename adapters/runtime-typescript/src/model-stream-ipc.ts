import type { ModelStreamEvent } from "@osva-ai/contracts";
import { modelStreamEventSchema } from "@osva-ai/contracts/schemas";

import { MODEL_STREAM_IPC_MAX_FRAME_BYTES } from "./constants.js";

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

export function validateModelStreamEventFrame(
  value: unknown,
): ModelStreamEvent | undefined {
  const parsed = modelStreamEventSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  const frameBytes = utf8ByteLength(JSON.stringify(parsed.data));
  if (frameBytes > MODEL_STREAM_IPC_MAX_FRAME_BYTES) {
    return undefined;
  }

  return parsed.data;
}
