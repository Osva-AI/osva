export async function run(context: {
  readonly input: unknown;
  readonly tools: {
    readonly invoke: (
      binding: string,
      input: unknown,
      options?: { readonly idempotencyKey?: string },
    ) => Promise<unknown>;
  };
}): Promise<{
  readonly echoed: unknown;
  readonly toolResult: unknown;
  readonly contextKeys: string[];
  readonly hasToolVersionId: boolean;
  readonly hasImplementationId: boolean;
}> {
  const toolResult = await context.tools.invoke("echo", {
    value: context.input,
  });

  return {
    echoed: context.input,
    toolResult,
    contextKeys: Object.keys(context).sort(),
    hasToolVersionId: "toolVersionId" in context,
    hasImplementationId: "implementation" in context,
  };
}
