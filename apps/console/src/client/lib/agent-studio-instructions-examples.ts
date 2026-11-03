export const INSTRUCTION_EXAMPLES_MARKER = "## Example interactions";

export function splitInstructionsAndExamples(instructions: string): {
  readonly baseInstructions: string;
  readonly examples: string;
  readonly examplesInManifest: boolean;
} {
  const markerIndex = instructions.indexOf(INSTRUCTION_EXAMPLES_MARKER);
  if (markerIndex === -1) {
    return {
      baseInstructions: instructions,
      examples: "",
      examplesInManifest: false,
    };
  }
  const baseInstructions = instructions.slice(0, markerIndex).trimEnd();
  const examples = instructions
    .slice(markerIndex + INSTRUCTION_EXAMPLES_MARKER.length)
    .trim();
  return {
    baseInstructions,
    examples,
    examplesInManifest: examples.length > 0,
  };
}

export function mergeExamplesIntoInstructions(
  baseInstructions: string,
  examples: string,
): string {
  const trimmedExamples = examples.trim();
  if (trimmedExamples.length === 0) {
    return baseInstructions.trim();
  }
  const base = baseInstructions.trim();
  if (base.includes(INSTRUCTION_EXAMPLES_MARKER)) {
    return baseInstructions;
  }
  return `${base}\n\n${INSTRUCTION_EXAMPLES_MARKER}\n${trimmedExamples}`;
}

export function removeExamplesFromInstructions(instructions: string): string {
  return splitInstructionsAndExamples(instructions).baseInstructions.trim();
}
