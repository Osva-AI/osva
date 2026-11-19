export async function run(context: {
  readonly models: {
    generateCompletionStream(
      binding: string,
      request: {
        readonly messages: readonly {
          readonly role: "system" | "user" | "assistant";
          readonly content: string;
        }[];
        readonly maxOutputTokens?: number;
      },
    ): AsyncIterable<{
      readonly kind: string;
      readonly textDelta?: string;
    }>;
  };
}): Promise<{
  readonly deltas: string[];
  readonly text: string;
  readonly eventKinds: string[];
}> {
  const deltas: string[] = [];
  const eventKinds: string[] = [];
  let text = "";

  for await (const event of context.models.generateCompletionStream("primary", {
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "stream-success-check" },
    ],
    maxOutputTokens: 500,
  })) {
    eventKinds.push(event.kind);
    if (event.kind === "TEXT_DELTA" && event.textDelta !== undefined) {
      deltas.push(event.textDelta);
      text += event.textDelta;
    }
  }

  return { deltas, text, eventKinds };
}
