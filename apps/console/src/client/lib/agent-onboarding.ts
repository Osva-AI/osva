export interface OnboardingContext {
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly runId?: string;
}

export interface OnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly to: string;
  readonly actionLabel: string;
  readonly requiresWrite?: boolean;
  readonly requiresExecute?: boolean;
}

export function parseOnboardingContext(
  searchParams: URLSearchParams,
): OnboardingContext {
  return {
    agentId: optionalId(searchParams.get("agentId")),
    agentVersionId: optionalId(searchParams.get("agentVersionId")),
    runId: optionalId(searchParams.get("runId")),
  };
}

export function onboardingSearch(context: OnboardingContext): string {
  const params = new URLSearchParams();
  if (context.agentId !== undefined) {
    params.set("agentId", context.agentId);
  }
  if (context.agentVersionId !== undefined) {
    params.set("agentVersionId", context.agentVersionId);
  }
  if (context.runId !== undefined) {
    params.set("runId", context.runId);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export function firstAgentOnboardingSteps(
  context: OnboardingContext,
): readonly OnboardingStep[] {
  const agentId = context.agentId;
  const agentVersionId = context.agentVersionId;
  const runId = context.runId;
  const versionPath =
    agentId !== undefined && agentVersionId !== undefined
      ? `/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`
      : agentId !== undefined
        ? `/agents/${encodeURIComponent(agentId)}`
        : "/agents";
  const builderSearch =
    agentId !== undefined && agentVersionId !== undefined
      ? `?agentId=${encodeURIComponent(agentId)}&agentVersionId=${encodeURIComponent(agentVersionId)}`
      : "";

  return [
    {
      id: "prerequisites",
      title: "Review prerequisites",
      description:
        "Control plane, PostgreSQL, Valkey, worker, and trusted runtime files are local operator setup. Console does not invent health from API success.",
      to: "/onboarding",
      actionLabel: "Readiness",
    },
    {
      id: "registry",
      title: "Open Agent Registry",
      description: "List Agents persisted in the authenticated workspace.",
      to: "/agents",
      actionLabel: "Open registry",
    },
    {
      id: "register",
      title: "Register Agent or choose an example",
      description:
        "Create a workspace Agent (key + name) or continue with the supported hello-agent example (no paid model provider).",
      to: "/agents/new",
      actionLabel: "Register Agent",
      requiresWrite: true,
    },
    {
      id: "version",
      title: "Select or create AgentVersion",
      description:
        "Append an immutable manifest. Previous versions are never rewritten.",
      to:
        agentId === undefined
          ? "/agents"
          : `/agents/${encodeURIComponent(agentId)}/versions/new`,
      actionLabel: "Create version",
      requiresWrite: true,
    },
    {
      id: "runtime",
      title: "Check runtime setup instructions",
      description:
        "Trusted TypeScript requires OSVA_TRUSTED_RUNTIME_ROOT and a matching sha256 integrity digest on the worker.",
      to: versionPath,
      actionLabel: "Runtime notes",
    },
    {
      id: "input",
      title: "Supply valid Run input",
      description:
        "Use the selected AgentVersion input schema. Syntax-valid JSON can still fail at execution.",
      to: versionPath,
      actionLabel: "Input contract",
    },
    {
      id: "launch",
      title: "Launch Run",
      description:
        "POST creates a queued Run bound to the selected AgentVersion. HTTP 201 is not a terminal SUCCEEDED status.",
      to: versionPath,
      actionLabel: "Run Agent",
      requiresExecute: true,
    },
    {
      id: "attempts",
      title: "Observe RunAttempts",
      description:
        "RunAttempts are canonical execution identity. They are not WorkflowNodeRuns.",
      to: runId === undefined ? "/runs" : `/runs/${encodeURIComponent(runId)}`,
      actionLabel: "Open Run",
    },
    {
      id: "output",
      title: "Inspect output and artifacts",
      description:
        "Terminal attempt output, persisted errors, and artifact preview/download stay on Run Detail.",
      to: runId === undefined ? "/runs" : `/runs/${encodeURIComponent(runId)}`,
      actionLabel: "Inspect output",
    },
    {
      id: "builder",
      title: "Open Workflow Builder and bind the AgentVersion",
      description:
        "Workflows pin immutable AgentVersion ids on AGENT nodes. Saving a workflow does not mutate the AgentVersion.",
      to: `/workflows/new${builderSearch}`,
      actionLabel: "Open builder",
      requiresWrite: true,
    },
  ];
}

function optionalId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
