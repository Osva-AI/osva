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
  readonly partialText: string;
  readonly terminalKind: string | null;
}> {
  let partialText = "";
  let terminalKind: string | null = null;

  for await (const event of context.models.generateCompletionStream("primary", {
    messages: [{ role: "user", content: "stream-mid-fail" }],
  })) {
    if (event.kind === "TEXT_DELTA" && event.textDelta !== undefined) {
      partialText += event.textDelta;
    }
    if (event.kind === "FAILED" || event.kind === "CANCELLED") {
      terminalKind = event.kind;
      throw new Error(`model stream ended with ${event.kind}`);
    }
    if (event.kind === "COMPLETED") {
      terminalKind = event.kind;
    }
  }

  return { partialText, terminalKind };
}
