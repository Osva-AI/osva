export interface HelloAgentInput {
  readonly message: string;
}

export interface HelloAgentOutput {
  readonly echoed: string;
}

function parseInput(input: unknown): HelloAgentInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("input must be an object");
  }
  const message = (input as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("input.message must be a non-empty string");
  }
  return { message };
}

export async function run(context: {
  readonly input: unknown;
}): Promise<HelloAgentOutput> {
  const { message } = parseInput(context.input);
  return { echoed: message };
}
