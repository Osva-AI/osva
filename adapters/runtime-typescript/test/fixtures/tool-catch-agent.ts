export async function run(context: {
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<{
  readonly caught: boolean;
  readonly code: string | null;
  readonly ok: true;
}> {
  try {
    await context.tools.invoke("missing", {});
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
