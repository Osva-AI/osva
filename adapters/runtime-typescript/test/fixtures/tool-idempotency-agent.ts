export async function run(context: {
  readonly tools: {
    readonly invoke: (
      binding: string,
      input: unknown,
      options?: { readonly idempotencyKey?: string },
    ) => Promise<unknown>;
  };
}): Promise<{ readonly ok: true }> {
  await context.tools.invoke(
    "echo",
    { value: true },
    { idempotencyKey: "caller-supplied-key" },
  );
  return { ok: true };
}
