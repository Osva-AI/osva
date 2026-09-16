export async function run(context: {
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
}): Promise<{ readonly ok: true }> {
  await context.models.generateText("missing", {
    messages: [{ role: "user", content: "hello" }],
  });
  return { ok: true };
}
