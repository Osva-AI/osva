export async function run(context: {
  readonly input: unknown;
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<unknown> {
  const record =
    context.input !== null && typeof context.input === "object"
      ? (context.input as { owner?: unknown; repo?: unknown })
      : {};
  const owner =
    typeof record.owner === "string" && record.owner.trim().length > 0
      ? record.owner.trim()
      : "Osva-AI";
  const repo =
    typeof record.repo === "string" && record.repo.trim().length > 0
      ? record.repo.trim()
      : "osva";
  return context.tools.invoke("githubRepositoryGet", { owner, repo });
}
