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
}): Promise<{
  readonly caught: boolean;
  readonly code: string | null;
  readonly ok: true;
}> {
  try {
    await context.models.generateText("missing", {
      messages: [{ role: "user", content: "hello" }],
    });
    return { caught: false, code: null, ok: true };
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    return { caught: true, code, ok: true };
  }
}
