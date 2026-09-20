export async function run(context: {
  readonly knowledge: {
    readonly search: (
      binding: string,
      query: string,
      options?: { readonly topK?: number },
    ) => Promise<
      ReadonlyArray<{
        readonly text: string;
        readonly knowledgeIndexId: string;
      }>
    >;
  };
  readonly input: { readonly query?: string };
}): Promise<{
  readonly firstText: string | null;
  readonly hitCount: number;
  readonly indexId: string | null;
}> {
  const hits = await context.knowledge.search(
    "company_docs",
    typeof context.input.query === "string"
      ? context.input.query
      : "refund policy",
    { topK: 3 },
  );
  return {
    firstText: hits[0]?.text ?? null,
    hitCount: hits.length,
    indexId: hits[0]?.knowledgeIndexId ?? null,
  };
}
