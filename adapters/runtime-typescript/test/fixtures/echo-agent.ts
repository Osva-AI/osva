export async function run(context: {
  readonly input: unknown;
  readonly runId: string;
  readonly runAttemptId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly models?: {
    readonly generateText: unknown;
  };
  readonly tools?: {
    readonly invoke: unknown;
  };
}): Promise<{
  readonly echoed: unknown;
  readonly ids: {
    readonly runId: string;
    readonly runAttemptId: string;
    readonly workspaceId: string;
    readonly agentId: string;
    readonly agentVersionId: string;
  };
  readonly contextKeys: string[];
  readonly hasJobId: boolean;
  readonly databaseUrl: string | null;
  readonly valkeyUrl: string | null;
  readonly openaiApiKey: string | null;
  readonly hasModels: boolean;
  readonly modelKeys: string[];
  readonly hasTools: boolean;
  readonly toolKeys: string[];
}> {
  return {
    echoed: context.input,
    ids: {
      runId: context.runId,
      runAttemptId: context.runAttemptId,
      workspaceId: context.workspaceId,
      agentId: context.agentId,
      agentVersionId: context.agentVersionId,
    },
    contextKeys: Object.keys(context).sort(),
    hasJobId: "jobId" in context,
    databaseUrl: process.env.OSVA_DATABASE_URL ?? null,
    valkeyUrl: process.env.OSVA_VALKEY_URL ?? null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    hasModels: "models" in context,
    modelKeys:
      context.models === undefined
        ? []
        : Object.keys(context.models as object).sort(),
    hasTools: "tools" in context,
    toolKeys:
      context.tools === undefined
        ? []
        : Object.keys(context.tools as object).sort(),
  };
}
