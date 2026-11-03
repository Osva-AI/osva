import { extractKnowledgeBindingRows } from "../../lib/agent-knowledge-bindings";
import { extractMemoryBindingRows } from "../../lib/agent-memory-bindings";
import {
  describeDeclarativeManifestValidation,
  extractDeclarativeStudioFields,
  parseManifestRecord,
} from "../../lib/declarative-agent-manifest";
import {
  canAdvanceFromDescribe,
  canAdvanceFromEquip,
  reviewPublishReady,
} from "../../lib/agent-studio-v2-stages";

export function AgentStudioDraftGlance(props: {
  readonly agentName: string;
  readonly manifestText: string;
  readonly canWrite: boolean;
  readonly optionalToolsEnabled: boolean;
  readonly optionalKnowledgeEnabled: boolean;
  readonly optionalMemoryEnabled: boolean;
}) {
  const parsed = parseManifestRecord(props.manifestText);
  const fields = parsed.ok
    ? extractDeclarativeStudioFields(parsed.value)
    : extractDeclarativeStudioFields(undefined);
  const validation = parsed.ok
    ? describeDeclarativeManifestValidation(parsed.value)
    : {
        ok: false,
        messages: parsed.ok ? [] : [parsed.message],
        fieldErrors: {},
      };

  const describeReady = canAdvanceFromDescribe({
    agentName: props.agentName,
    instructions: fields.instructions,
    manifestParseOk: parsed.ok,
  }).ok;
  const equipReady = canAdvanceFromEquip({
    manifestParseOk: parsed.ok,
    modelProfileVersionId: fields.modelProfileVersionId,
  }).ok;
  const publishReady = reviewPublishReady({
    canWrite: props.canWrite,
    validation,
    manifestParseOk: parsed.ok,
  });

  const toolSummary =
    parsed.ok && isRecord(parsed.value.tools)
      ? Object.keys(parsed.value.tools).join(", ") || "None yet"
      : "None yet";
  const knowledgeSummary =
    parsed.ok && extractKnowledgeBindingRows(parsed.value).length > 0
      ? `${String(extractKnowledgeBindingRows(parsed.value).length)} source(s)`
      : props.optionalKnowledgeEnabled
        ? "Not configured"
        : "Not added";
  const memorySummary =
    parsed.ok && extractMemoryBindingRows(parsed.value).length > 0
      ? `${String(extractMemoryBindingRows(parsed.value).length)} namespace(s)`
      : props.optionalMemoryEnabled
        ? "Not configured"
        : "Not added";

  return (
    <aside
      className="agent-studio-v2-glance panel"
      aria-label="Your agent at a glance"
      data-testid="agent-studio-draft-glance"
    >
      <h2 className="agent-studio-v2-glance-title">Your agent at a glance</h2>
      <p className="muted agent-studio-v2-glance-note">
        Draft only — publishing creates an immutable version.
      </p>
      <dl className="agent-studio-v2-glance-list">
        <div>
          <dt>Name</dt>
          <dd>{props.agentName.trim().length > 0 ? props.agentName : "—"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {fields.modelProfileVersionId.length > 0
              ? fields.modelProfileVersionId
              : "Not selected"}
          </dd>
        </div>
        {props.optionalToolsEnabled ? (
          <div>
            <dt>Tools</dt>
            <dd>{toolSummary}</dd>
          </div>
        ) : null}
        {props.optionalKnowledgeEnabled ? (
          <div>
            <dt>Knowledge</dt>
            <dd>{knowledgeSummary}</dd>
          </div>
        ) : null}
        {props.optionalMemoryEnabled ? (
          <div>
            <dt>Memory</dt>
            <dd>{memorySummary}</dd>
          </div>
        ) : null}
        <div>
          <dt>Ready to publish</dt>
          <dd>
            {publishReady
              ? "Yes, after review"
              : !describeReady
                ? "Add name and instructions"
                : !equipReady
                  ? "Choose a model"
                  : "Fix validation issues"}
          </dd>
        </div>
      </dl>
      <div className="agent-studio-v2-glance-help panel">
        <strong>Tip</strong>
        <p className="muted">
          Optional tools, knowledge, and memory stay hidden until you add them.
          Advanced JSON edits the same draft as this guided flow.
        </p>
      </div>
    </aside>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
