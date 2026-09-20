import { createHash } from "node:crypto";

import type { EmbeddingProviderAdapter } from "./provider-adapter.js";

export class DeterministicEmbeddingProviderAdapter implements EmbeddingProviderAdapter {
  readonly provider = "DETERMINISTIC";

  async embed(request: {
    readonly texts: readonly string[];
    readonly model: string;
    readonly dimensions: number;
  }): Promise<readonly (readonly number[])[]> {
    return request.texts.map((text) =>
      vectorFromText(text, request.dimensions),
    );
  }
}

function vectorFromText(text: string, dimensions: number): readonly number[] {
  const values: number[] = [];
  for (let index = 0; index < dimensions; index += 1) {
    const digest = createHash("sha256")
      .update(`${text}:${String(index)}`)
      .digest();
    const byte = digest[index % digest.length]!;
    values.push((byte / 255) * 2 - 1);
  }
  return normalize(values);
}

function normalize(values: number[]): readonly number[] {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );
  if (magnitude === 0) {
    return values;
  }
  return values.map((value) => value / magnitude);
}
