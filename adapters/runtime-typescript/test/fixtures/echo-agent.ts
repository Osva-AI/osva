export async function run(context: {
  readonly input: unknown;
  readonly runId: string;
  readonly runAttemptId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
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
  };
}
