export async function run(context: {
  readonly input: unknown;
}): Promise<{ readonly echoed: unknown }> {
  return { echoed: context.input };
}
