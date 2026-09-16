export async function run(context: {
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<{
  readonly caught: boolean;
  readonly code: string | null;
}> {
  try {
    await context.tools.invoke("missing", { probe: true });
    return { caught: false, code: null };
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    return { caught: true, code };
  }
}
