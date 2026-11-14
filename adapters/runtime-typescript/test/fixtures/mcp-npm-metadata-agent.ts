export async function run(context: {
  readonly input: unknown;
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<{
  readonly packageName: string;
  readonly metadata: unknown;
}> {
  const inputRecord =
    context.input !== null && typeof context.input === "object"
      ? (context.input as { packageName?: unknown })
      : {};
  const packageName =
    typeof inputRecord.packageName === "string" &&
    inputRecord.packageName.trim().length > 0
      ? inputRecord.packageName.trim()
      : "lodash";
  const metadata = await context.tools.invoke("npm_package_metadata", {
    packageName,
  });
  return { packageName, metadata };
}
