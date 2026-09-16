export async function run(context: {
  readonly input: unknown;
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<{
  readonly echoed: unknown;
  readonly toolResult: unknown;
}> {
  const toolResult = await context.tools.invoke("echo", {
    value: context.input,
  });

  return {
    echoed: context.input,
    toolResult,
  };
}
