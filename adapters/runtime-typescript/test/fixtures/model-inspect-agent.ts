export async function run(context: { readonly models?: object }): Promise<{
  readonly contextKeys: string[];
  readonly modelKeys: string[];
  readonly openaiApiKey: string | null;
  readonly hasGenerateText: boolean;
  readonly hasProvider: boolean;
  readonly hasOpenAI: boolean;
  readonly hasApiKey: boolean;
  readonly hasClient: boolean;
  readonly hasModelProfileVersionId: boolean;
}> {
  const models = (context.models ?? {}) as Record<string, unknown>;
  return {
    contextKeys: Object.keys(context).sort(),
    modelKeys: Object.keys(models).sort(),
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    hasGenerateText: typeof models.generateText === "function",
    hasProvider: "provider" in context,
    hasOpenAI: "openai" in context,
    hasApiKey: "apiKey" in models,
    hasClient: "client" in models,
    hasModelProfileVersionId: "modelProfileVersionId" in context,
  };
}
