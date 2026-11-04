import { Link } from "react-router-dom";

import type { AgentVersionResource } from "../../hooks/use-agents";
import { AgentRunLaunchForm } from "./agent-run-launch-form";
import { AgentStudioV2Progress } from "./agent-studio-v2-progress";

export function AgentStudioTestStagePanel(props: {
  readonly agentId: string;
  readonly agentKey?: string;
  readonly agentName?: string;
  readonly version: AgentVersionResource;
  readonly canExecute: boolean;
  readonly versionLoading?: boolean;
}) {
  return (
    <section
      className="agent-studio-v2-test panel"
      data-testid="agent-studio-test-stage"
      aria-labelledby="agent-studio-test-title"
    >
      <AgentStudioV2Progress current="test" maxReachable="test" />
      <p className="agent-studio-v2-eyebrow">Step 4 · Test</p>
      <h2 id="agent-studio-test-title" className="agent-studio-v2-headline">
        Test your agent
      </h2>
      {props.agentName !== undefined && props.agentName.trim().length > 0 ? (
        <p className="agent-studio-test-agent-name">{props.agentName}</p>
      ) : null}
      <p className="muted agent-studio-v2-lead">
        Launch a real Run against the version you just published. Queued and
        running states mean work is still in progress — only a succeeded Run
        confirms execution output.
      </p>
      <AgentRunLaunchForm
        agentId={props.agentId}
        agentKey={props.agentKey}
        agentName={props.agentName}
        selectedVersion={props.version}
        canExecute={props.canExecute}
        versionLoading={props.versionLoading}
        presentation="studio"
      />
      <p className="muted">
        <Link to={`/agents/${props.agentId}`}>Back to agent detail</Link>
      </p>
    </section>
  );
}
