export async function run(context: {
  readonly knowledge: {
    readonly search: (binding: string, query: string) => Promise<unknown>;
  };
}): Promise<{
  readonly caught: boolean;
  readonly code: string | null;
  readonly ok: true;
}> {
  try {
    await context.knowledge.search("missing_binding", "x");
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
