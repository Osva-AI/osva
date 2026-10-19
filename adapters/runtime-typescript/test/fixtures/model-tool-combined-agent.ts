export async function run(context: {
  readonly input: unknown;
  readonly models: {
    generateText(
      binding: string,
      request: {
        readonly messages: readonly {
          readonly role: "system" | "user" | "assistant";
          readonly content: string;
        }[];
      },
    ): Promise<{ readonly text: string }>;
  };
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<{
  readonly modelText: string;
  readonly toolResult: unknown;
}> {
  const model = await context.models.generateText("primary", {
    messages: [{ role: "user", content: "combined-capability-check" }],
  });
  const toolResult = await context.tools.invoke("echo", {
    value: context.input,
  });
  return { modelText: model.text, toolResult };
}
