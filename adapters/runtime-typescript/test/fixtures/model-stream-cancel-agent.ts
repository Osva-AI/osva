export async function run(context: {
  readonly models: {
    generateCompletionStream(
      binding: string,
      request: {
        readonly messages: readonly {
          readonly role: "system" | "user" | "assistant";
          readonly content: string;
        }[];
      },
    ): AsyncIterable<{
      readonly kind: string;
      readonly textDelta?: string;
    }>;
  };
}): Promise<{
  readonly deltas: string[];
  readonly stoppedEarly: boolean;
}> {
  const deltas: string[] = [];

  for await (const event of context.models.generateCompletionStream("primary", {
    messages: [{ role: "user", content: "stream-cancel" }],
  })) {
    if (event.kind === "TEXT_DELTA" && event.textDelta !== undefined) {
      deltas.push(event.textDelta);
      break;
    }
  }

  return { deltas, stoppedEarly: true };
}
