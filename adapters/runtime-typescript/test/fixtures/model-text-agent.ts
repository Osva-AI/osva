export async function run(context: {
  readonly models: {
    generateText(
      binding: string,
      request: {
        readonly messages: readonly {
          readonly role: "system" | "user" | "assistant";
          readonly content: string;
        }[];
        readonly maxOutputTokens?: number;
      },
    ): Promise<{ readonly text: string }>;
  };
}): Promise<{ readonly text: string }> {
  const result = await context.models.generateText("primary", {
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Explain this concept." },
    ],
    maxOutputTokens: 500,
  });
  return { text: result.text };
}
