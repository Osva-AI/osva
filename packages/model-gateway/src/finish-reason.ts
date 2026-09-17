export const MODEL_FINISH_REASONS = [
  "stop",
  "length",
  "blocked",
  "tool_call",
  "other",
] as const;

export type ModelFinishReason = (typeof MODEL_FINISH_REASONS)[number];

export function isModelFinishReason(value: string): value is ModelFinishReason {
  return (MODEL_FINISH_REASONS as readonly string[]).includes(value);
}
