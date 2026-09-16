export async function run(context: {
  readonly input: unknown;
}): Promise<{ readonly echoed: unknown }> {
  console.log("agent stdout must not become the result");
  console.error("agent stderr must not become the result");
  return { echoed: context.input };
}
