import {
  type AgentVersionId,
  DECLARATIVE_INSTRUCTIONS_MAX_LENGTH,
  MODEL_BINDING_NAME_PATTERN,
  type ModelProfileVersionId,
  type ToolVersionId,
  TOOL_BINDING_NAME_PATTERN,
  WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_APPROVAL_TITLE_MAX_LENGTH,
  type WorkflowDefinitionEdgeV1,
  isValidJsonPointer,
  isValidUtcIso8601Instant,
} from "@osva-ai/contracts";

import {
  BUILDER_PROPOSAL_SCHEMA_VERSION,
  type BuilderProposalAgentRef,
  type BuilderProposalAgentSpecV1,
  type BuilderProposalExistingAgentV1,
  type BuilderProposalNewAgentV1,
  type BuilderProposalNewAgentToolSelectionV1,
  type BuilderProposalV1,
  type BuilderProposalWorkflowNodeIntentV1,
} from "./builder-proposal.js";

const BUILDER_MAX_AGENTS = 64;
const BUILDER_MAX_WORKFLOW_NODES = 256;
const BUILDER_MAX_WORKFLOW_EDGES = 512;
const BUILDER_MAX_STRING_LIST = 32;
const BUILDER_MAX_TOOLS_PER_AGENT = 32;
const BUILDER_MAX_REGISTRY_KEY_LENGTH = 200;
const BUILDER_MAX_AGENT_KEY_LENGTH = 200;
const BUILDER_MAX_AGENT_NAME_LENGTH = 200;

/** `bpr_` + 1–128 URL-safe characters. */
export const BUILDER_PROPOSAL_AGENT_REF_PATTERN = /^bpr_[A-Za-z0-9_-]{1,128}$/;

const MODEL_BINDING_RE = new RegExp(MODEL_BINDING_NAME_PATTERN);
const TOOL_BINDING_RE = new RegExp(TOOL_BINDING_NAME_PATTERN);

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBranchEqualsValue(
  value: unknown,
): value is string | number | boolean | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  return isFiniteNumber(value);
}

function isJsonSchemaRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

function err(ctx: string, message: string): string {
  return ctx.length > 0 ? `${ctx}: ${message}` : message;
}

function assertAgentRef(ctx: string, value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !BUILDER_PROPOSAL_AGENT_REF_PATTERN.test(value)
  ) {
    return err(
      ctx,
      "Agent ref must be bpr_ followed by 1–128 letters, digits, underscore, or hyphen.",
    );
  }

  return undefined;
}

function parseNewAgent(
  ctx: string,
  spec: Record<string, unknown>,
): { agent?: BuilderProposalNewAgentV1; error?: string } {
  if (spec.kind !== "NEW") {
    return { error: err(ctx, "kind must be NEW.") };
  }

  const refMsg = assertAgentRef(`${ctx}.ref`, spec.ref);
  if (refMsg !== undefined) {
    return { error: refMsg };
  }

  const ref = spec.ref as BuilderProposalAgentRef;

  if (
    !isNonEmptyTrimmedString(spec.agentKey) ||
    spec.agentKey.length > BUILDER_MAX_AGENT_KEY_LENGTH
  ) {
    return {
      error: err(
        ctx,
        `agentKey must be 1–${String(BUILDER_MAX_AGENT_KEY_LENGTH)} non-empty characters.`,
      ),
    };
  }

  if (
    !isNonEmptyTrimmedString(spec.agentName) ||
    spec.agentName.length > BUILDER_MAX_AGENT_NAME_LENGTH
  ) {
    return {
      error: err(
        ctx,
        `agentName must be 1–${String(BUILDER_MAX_AGENT_NAME_LENGTH)} non-empty characters.`,
      ),
    };
  }

  if (
    typeof spec.instructions !== "string" ||
    spec.instructions.trim().length === 0
  ) {
    return { error: err(ctx, "instructions must be a non-empty string.") };
  }

  if (spec.instructions.length > DECLARATIVE_INSTRUCTIONS_MAX_LENGTH) {
    return {
      error: err(
        ctx,
        `instructions must be at most ${String(DECLARATIVE_INSTRUCTIONS_MAX_LENGTH)} characters.`,
      ),
    };
  }

  if (
    !isJsonSchemaRecord(spec.inputSchema) ||
    !isJsonSchemaRecord(spec.outputSchema)
  ) {
    return { error: err(ctx, "inputSchema and outputSchema must be objects.") };
  }

  if (
    typeof spec.modelBindingName !== "string" ||
    !MODEL_BINDING_RE.test(spec.modelBindingName)
  ) {
    return {
      error: err(
        ctx,
        "modelBindingName must match logical model binding name rules.",
      ),
    };
  }

  const model = spec.model;
  if (!isPlainObject(model)) {
    return { error: err(ctx, "model must be an object.") };
  }

  if (
    typeof model.bindingName !== "string" ||
    !MODEL_BINDING_RE.test(model.bindingName)
  ) {
    return {
      error: err(
        `${ctx}.model`,
        "bindingName must be a valid model binding name.",
      ),
    };
  }

  if (
    typeof model.modelProfileVersionId !== "string" ||
    model.modelProfileVersionId.length === 0
  ) {
    return {
      error: err(
        `${ctx}.model`,
        "modelProfileVersionId must be a non-empty string.",
      ),
    };
  }

  if (model.bindingName !== spec.modelBindingName) {
    return {
      error: err(
        ctx,
        "model.bindingName must match modelBindingName (single logical binding for M20.1).",
      ),
    };
  }

  const toolsRaw = spec.tools;
  if (!Array.isArray(toolsRaw)) {
    return { error: err(ctx, "tools must be an array.") };
  }

  if (toolsRaw.length > BUILDER_MAX_TOOLS_PER_AGENT) {
    return {
      error: err(
        ctx,
        `tools may contain at most ${String(BUILDER_MAX_TOOLS_PER_AGENT)} selections.`,
      ),
    };
  }

  const tools: BuilderProposalNewAgentToolSelectionV1[] = [];
  const seenBindingNames = new Set<string>();
  const seenToolVersionIds = new Set<string>();
  for (let i = 0; i < toolsRaw.length; i += 1) {
    const t = toolsRaw[i];
    const tctx = `${ctx}.tools[${String(i)}]`;
    if (!isPlainObject(t)) {
      return { error: err(tctx, "tool selection must be an object.") };
    }

    if (
      typeof t.bindingName !== "string" ||
      !TOOL_BINDING_RE.test(t.bindingName)
    ) {
      return {
        error: err(tctx, "bindingName must be a valid tool binding name."),
      };
    }

    if (typeof t.toolVersionId !== "string" || t.toolVersionId.length === 0) {
      return { error: err(tctx, "toolVersionId must be a non-empty string.") };
    }

    if (seenBindingNames.has(t.bindingName)) {
      return {
        error: err(
          tctx,
          `Duplicate tool binding name '${t.bindingName}' on agent ${ref}.`,
        ),
      };
    }

    seenBindingNames.add(t.bindingName);

    if (seenToolVersionIds.has(t.toolVersionId)) {
      return {
        error: err(tctx, `Duplicate toolVersionId on agent ${ref}.`),
      };
    }

    seenToolVersionIds.add(t.toolVersionId);
    tools.push({
      bindingName: t.bindingName,
      toolVersionId: t.toolVersionId as ToolVersionId,
    });
  }

  const execution = spec.execution;
  if (!isPlainObject(execution)) {
    return { error: err(ctx, "execution must be an object.") };
  }

  const exec = execution as Record<string, unknown>;
  if (
    typeof exec.timeoutMs !== "number" ||
    !Number.isInteger(exec.timeoutMs) ||
    exec.timeoutMs < 100 ||
    exec.timeoutMs > 300_000
  ) {
    return {
      error: err(
        `${ctx}.execution`,
        "timeoutMs must be an integer 100–300000.",
      ),
    };
  }

  if (
    typeof exec.maxAttempts !== "number" ||
    !Number.isInteger(exec.maxAttempts) ||
    exec.maxAttempts < 1
  ) {
    return {
      error: err(`${ctx}.execution`, "maxAttempts must be an integer >= 1."),
    };
  }

  if (
    typeof exec.maxModelInvocations !== "number" ||
    !Number.isInteger(exec.maxModelInvocations) ||
    exec.maxModelInvocations < 1 ||
    exec.maxModelInvocations > 32
  ) {
    return {
      error: err(
        `${ctx}.execution`,
        "maxModelInvocations must be an integer 1–32.",
      ),
    };
  }

  if (
    typeof exec.maxToolInvocations !== "number" ||
    !Number.isInteger(exec.maxToolInvocations) ||
    exec.maxToolInvocations < 0 ||
    exec.maxToolInvocations > 64
  ) {
    return {
      error: err(
        `${ctx}.execution`,
        "maxToolInvocations must be an integer 0–64.",
      ),
    };
  }

  if (exec.maxOutputTokens !== undefined) {
    if (
      typeof exec.maxOutputTokens !== "number" ||
      !Number.isInteger(exec.maxOutputTokens) ||
      exec.maxOutputTokens < 1 ||
      exec.maxOutputTokens > 16_384
    ) {
      return {
        error: err(
          `${ctx}.execution`,
          "maxOutputTokens must be an integer 1–16384 when present.",
        ),
      };
    }
  }

  if (
    exec.checkpointingEnabled !== undefined &&
    typeof exec.checkpointingEnabled !== "boolean"
  ) {
    return {
      error: err(
        `${ctx}.execution`,
        "checkpointingEnabled must be boolean when present.",
      ),
    };
  }

  if (
    exec.automaticRecoveryEnabled !== undefined &&
    typeof exec.automaticRecoveryEnabled !== "boolean"
  ) {
    return {
      error: err(
        `${ctx}.execution`,
        "automaticRecoveryEnabled must be boolean when present.",
      ),
    };
  }

  const agent: BuilderProposalNewAgentV1 = {
    kind: "NEW",
    ref,
    agentKey: spec.agentKey,
    agentName: spec.agentName,
    instructions: spec.instructions,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    modelBindingName: spec.modelBindingName,
    model: {
      bindingName: model.bindingName,
      modelProfileVersionId:
        model.modelProfileVersionId as ModelProfileVersionId,
    },
    tools,
    execution: {
      timeoutMs: exec.timeoutMs,
      maxAttempts: exec.maxAttempts,
      maxModelInvocations: exec.maxModelInvocations,
      maxToolInvocations: exec.maxToolInvocations,
      maxOutputTokens: exec.maxOutputTokens,
      checkpointingEnabled: exec.checkpointingEnabled,
      automaticRecoveryEnabled: exec.automaticRecoveryEnabled,
    },
  };

  return { agent };
}

function parseExistingAgent(
  ctx: string,
  spec: Record<string, unknown>,
): { agent?: BuilderProposalExistingAgentV1; error?: string } {
  if (spec.kind !== "EXISTING") {
    return { error: err(ctx, "kind must be EXISTING.") };
  }

  const refMsg = assertAgentRef(`${ctx}.ref`, spec.ref);
  if (refMsg !== undefined) {
    return { error: refMsg };
  }

  if (
    typeof spec.agentVersionId !== "string" ||
    spec.agentVersionId.length === 0
  ) {
    return { error: err(ctx, "agentVersionId must be a non-empty string.") };
  }

  return {
    agent: {
      kind: "EXISTING",
      ref: spec.ref as BuilderProposalAgentRef,
      agentVersionId: spec.agentVersionId as AgentVersionId,
    },
  };
}

function parseWorkflowNode(
  ctx: string,
  node: unknown,
): { node?: BuilderProposalWorkflowNodeIntentV1; error?: string } {
  if (!isPlainObject(node)) {
    return { error: err(ctx, "Node must be an object.") };
  }

  const nodeType = node.type;
  if (typeof node.key !== "string" || node.key.length === 0) {
    return { error: err(ctx, "Node key must be a non-empty string.") };
  }

  if (nodeType === "AGENT") {
    const refMsg = assertAgentRef(`${ctx}.agentRef`, node.agentRef);
    if (refMsg !== undefined) {
      return { error: refMsg };
    }

    return {
      node: {
        key: node.key,
        type: "AGENT",
        agentRef: node.agentRef as BuilderProposalAgentRef,
      },
    };
  }

  if (nodeType === "BRANCH") {
    if (
      typeof node.selector !== "string" ||
      !isValidJsonPointer(node.selector)
    ) {
      return {
        error: err(ctx, "BRANCH selector must be a valid JSON Pointer."),
      };
    }

    if (typeof node.defaultTo !== "string" || node.defaultTo.length === 0) {
      return { error: err(ctx, "BRANCH defaultTo must be non-empty.") };
    }

    if (!Array.isArray(node.cases) || node.cases.length === 0) {
      return { error: err(ctx, "BRANCH cases must be a non-empty array.") };
    }

    const cases: { equals: string | number | boolean | null; to: string }[] =
      [];
    const seenEquals = new Set<string>();
    for (let i = 0; i < node.cases.length; i += 1) {
      const c = node.cases[i];
      const cctx = `${ctx}.cases[${String(i)}]`;
      if (!isPlainObject(c)) {
        return { error: err(cctx, "case must be an object.") };
      }

      if (!isBranchEqualsValue(c.equals)) {
        return {
          error: err(
            cctx,
            "equals must be string, finite number, boolean, or null.",
          ),
        };
      }

      if (typeof c.to !== "string" || c.to.length === 0) {
        return { error: err(cctx, "to must be a non-empty string.") };
      }

      const encoded = JSON.stringify(c.equals);
      if (seenEquals.has(encoded)) {
        return { error: err(cctx, "duplicate equals value in BRANCH cases.") };
      }

      seenEquals.add(encoded);
      cases.push({ equals: c.equals, to: c.to });
    }

    return {
      node: {
        key: node.key,
        type: "BRANCH",
        selector: node.selector,
        cases,
        defaultTo: node.defaultTo,
      },
    };
  }

  if (nodeType === "PARALLEL") {
    return { node: { key: node.key, type: "PARALLEL" } };
  }

  if (nodeType === "JOIN") {
    return { node: { key: node.key, type: "JOIN" } };
  }

  if (nodeType === "APPROVAL") {
    if (
      typeof node.title !== "string" ||
      node.title.length === 0 ||
      node.title.length > WORKFLOW_APPROVAL_TITLE_MAX_LENGTH
    ) {
      return {
        error: err(
          ctx,
          `APPROVAL title must be 1–${String(WORKFLOW_APPROVAL_TITLE_MAX_LENGTH)} characters.`,
        ),
      };
    }

    if (node.description !== undefined) {
      if (
        typeof node.description !== "string" ||
        node.description.length === 0 ||
        node.description.length > WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH
      ) {
        return {
          error: err(
            ctx,
            `APPROVAL description must be 1–${String(WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH)} characters when present.`,
          ),
        };
      }
    }

    return {
      node: {
        key: node.key,
        type: "APPROVAL",
        title: node.title,
        ...(node.description === undefined
          ? {}
          : { description: node.description }),
      },
    };
  }

  if (nodeType === "WAIT") {
    const wait = node.wait;
    if (!isPlainObject(wait)) {
      return { error: err(ctx, "WAIT wait must be an object.") };
    }

    const kind = wait.kind;
    if (kind === "DURATION") {
      if (!isPositiveSafeInteger(wait.durationMs)) {
        return {
          error: err(
            `${ctx}.wait`,
            "DURATION durationMs must be a positive safe integer.",
          ),
        };
      }

      return {
        node: {
          key: node.key,
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: wait.durationMs },
        },
      };
    }

    if (kind === "UNTIL") {
      if (
        typeof wait.until !== "string" ||
        !isValidUtcIso8601Instant(wait.until)
      ) {
        return {
          error: err(
            `${ctx}.wait`,
            "UNTIL until must be a canonical UTC ISO-8601 instant.",
          ),
        };
      }

      return {
        node: {
          key: node.key,
          type: "WAIT",
          wait: { kind: "UNTIL", until: wait.until },
        },
      };
    }

    if (kind === "EVENT") {
      if (typeof wait.source !== "string" || wait.source.length === 0) {
        return { error: err(`${ctx}.wait`, "EVENT source must be non-empty.") };
      }

      if (typeof wait.eventType !== "string" || wait.eventType.length === 0) {
        return {
          error: err(`${ctx}.wait`, "EVENT eventType must be non-empty."),
        };
      }

      const corr = wait.correlation;
      if (!isPlainObject(corr)) {
        return { error: err(`${ctx}.wait`, "correlation must be an object.") };
      }

      if (corr.kind === "LITERAL") {
        if (typeof corr.value !== "string" || corr.value.length === 0) {
          return {
            error: err(
              `${ctx}.wait.correlation`,
              "LITERAL value must be non-empty.",
            ),
          };
        }

        const built = {
          kind: "EVENT" as const,
          source: wait.source,
          eventType: wait.eventType,
          correlation: { kind: "LITERAL" as const, value: corr.value },
          ...(wait.timeoutMs === undefined
            ? {}
            : { timeoutMs: wait.timeoutMs as number }),
        };

        if (
          wait.timeoutMs !== undefined &&
          !isPositiveSafeInteger(wait.timeoutMs)
        ) {
          return {
            error: err(
              `${ctx}.wait`,
              "EVENT timeoutMs must be a positive safe integer when present.",
            ),
          };
        }

        return { node: { key: node.key, type: "WAIT", wait: built } };
      }

      if (corr.kind === "INPUT_POINTER") {
        if (
          typeof corr.pointer !== "string" ||
          !isValidJsonPointer(corr.pointer)
        ) {
          return {
            error: err(
              `${ctx}.wait.correlation`,
              "INPUT_POINTER pointer must be a valid JSON Pointer.",
            ),
          };
        }

        const built = {
          kind: "EVENT" as const,
          source: wait.source,
          eventType: wait.eventType,
          correlation: {
            kind: "INPUT_POINTER" as const,
            pointer: corr.pointer,
          },
          ...(wait.timeoutMs === undefined
            ? {}
            : { timeoutMs: wait.timeoutMs as number }),
        };

        if (
          wait.timeoutMs !== undefined &&
          !isPositiveSafeInteger(wait.timeoutMs)
        ) {
          return {
            error: err(
              `${ctx}.wait`,
              "EVENT timeoutMs must be a positive safe integer when present.",
            ),
          };
        }

        return { node: { key: node.key, type: "WAIT", wait: built } };
      }

      return {
        error: err(`${ctx}.wait`, "Unsupported WAIT EVENT correlation kind."),
      };
    }

    return { error: err(`${ctx}.wait`, "Unsupported WAIT kind.") };
  }

  return {
    error: err(
      ctx,
      `Unsupported node type '${String(nodeType)}'. V3 builder supports AGENT, BRANCH, PARALLEL, JOIN, APPROVAL, WAIT.`,
    ),
  };
}

function parseStringList(
  ctx: string,
  value: unknown,
  max: number,
): { ok: string[]; error?: string } {
  if (value === undefined) {
    return { ok: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: [], error: err(ctx, "must be an array.") };
  }

  if (value.length > max) {
    return {
      ok: [],
      error: err(ctx, `must have at most ${String(max)} entries.`),
    };
  }

  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || item.length === 0) {
      return {
        ok: [],
        error: err(`${ctx}[${String(i)}]`, "must be a non-empty string."),
      };
    }

    out.push(item);
  }

  return { ok: out };
}

/**
 * OpenAI strict json_schema emits `null` for omitted optional fields; coerce to absent
 * values before structural validation (preserves meaningful nulls such as BRANCH equals).
 */
export function normalizeOpenAiStructuredProposalNulls(
  unknown: unknown,
): unknown {
  if (!isPlainObject(unknown)) {
    return unknown;
  }

  const registry = unknown.workflowRegistry;
  let workflowRegistry = registry;
  if (isPlainObject(registry) && registry.description === null) {
    workflowRegistry = {
      key: registry.key,
      name: registry.name,
    };
  }

  const agentsRaw = unknown.agents;
  let agents = agentsRaw;
  if (Array.isArray(agentsRaw)) {
    agents = agentsRaw.map((agent) => {
      if (!isPlainObject(agent) || agent.kind !== "NEW") {
        return agent;
      }

      const execution = agent.execution;
      if (!isPlainObject(execution)) {
        return agent;
      }

      const cleanedExecution = { ...execution };
      for (const key of [
        "maxOutputTokens",
        "checkpointingEnabled",
        "automaticRecoveryEnabled",
      ] as const) {
        if (cleanedExecution[key] === null) {
          delete cleanedExecution[key];
        }
      }

      return { ...agent, execution: cleanedExecution };
    });
  }

  const workflow = unknown.workflow;
  let workflowNormalized = workflow;
  if (isPlainObject(workflow) && Array.isArray(workflow.nodes)) {
    const nodes = workflow.nodes.map((node) => {
      if (!isPlainObject(node)) {
        return node;
      }

      if (node.type === "APPROVAL" && node.description === null) {
        return {
          key: node.key,
          type: node.type,
          title: node.title,
        };
      }

      if (node.type === "WAIT" && isPlainObject(node.wait)) {
        const wait = { ...node.wait };
        if (wait.timeoutMs === null) {
          delete wait.timeoutMs;
        }

        return { ...node, wait };
      }

      return node;
    });
    workflowNormalized = { ...workflow, nodes };
  }

  return {
    ...unknown,
    workflowRegistry,
    agents,
    workflow: workflowNormalized,
  };
}

/**
 * Parse and validate an internal BuilderProposalV1 document.
 */
export function parseBuilderProposalV1(
  unknown: unknown,
): BuilderProposalParseResult {
  unknown = normalizeOpenAiStructuredProposalNulls(unknown);

  if (!isPlainObject(unknown)) {
    return {
      ok: false,
      messages: ["proposal must be a strict object with schemaVersion 1."],
    };
  }

  const extraKeys = Object.keys(unknown).filter(
    (key) =>
      ![
        "schemaVersion",
        "workflowRegistry",
        "agents",
        "workflow",
        "assumptions",
        "unresolvedRequirements",
      ].includes(key),
  );
  if (extraKeys.length > 0) {
    return {
      ok: false,
      messages: [`Unexpected fields: ${extraKeys.sort().join(", ")}.`],
    };
  }

  if (unknown.schemaVersion !== BUILDER_PROPOSAL_SCHEMA_VERSION) {
    return {
      ok: false,
      messages: [`schemaVersion must be '${BUILDER_PROPOSAL_SCHEMA_VERSION}'.`],
    };
  }

  const messages: string[] = [];

  const registry = unknown.workflowRegistry;
  if (!isPlainObject(registry)) {
    messages.push("workflowRegistry must be an object.");
  } else {
    if (
      !isNonEmptyTrimmedString(registry.key) ||
      registry.key.length > BUILDER_MAX_REGISTRY_KEY_LENGTH
    ) {
      messages.push(
        `workflowRegistry.key must be 1–${String(BUILDER_MAX_REGISTRY_KEY_LENGTH)} characters.`,
      );
    }

    if (
      !isNonEmptyTrimmedString(registry.name) ||
      registry.name.length > BUILDER_MAX_REGISTRY_KEY_LENGTH
    ) {
      messages.push(
        `workflowRegistry.name must be 1–${String(BUILDER_MAX_REGISTRY_KEY_LENGTH)} characters.`,
      );
    }

    if (registry.description !== undefined) {
      if (
        typeof registry.description !== "string" ||
        registry.description.length === 0 ||
        registry.description.length > 2000
      ) {
        messages.push(
          "workflowRegistry.description must be 1–2000 characters when present.",
        );
      }
    }
  }

  const agentsRaw = unknown.agents;
  if (!Array.isArray(agentsRaw)) {
    messages.push("agents must be an array.");
  } else if (agentsRaw.length === 0 || agentsRaw.length > BUILDER_MAX_AGENTS) {
    messages.push(`agents must have 1–${String(BUILDER_MAX_AGENTS)} entries.`);
  }

  const workflow = unknown.workflow;
  if (!isPlainObject(workflow)) {
    messages.push("workflow must be an object.");
  }

  const assumptionsParsed = parseStringList(
    "assumptions",
    unknown.assumptions,
    BUILDER_MAX_STRING_LIST,
  );
  if (assumptionsParsed.error !== undefined) {
    messages.push(assumptionsParsed.error);
  }

  const unresolvedParsed = parseStringList(
    "unresolvedRequirements",
    unknown.unresolvedRequirements,
    BUILDER_MAX_STRING_LIST,
  );
  if (unresolvedParsed.error !== undefined) {
    messages.push(unresolvedParsed.error);
  }

  const agents: BuilderProposalAgentSpecV1[] = [];
  const seenAgentRefs = new Set<string>();
  for (let i = 0; i < (agentsRaw as unknown[]).length; i += 1) {
    const raw = (agentsRaw as unknown[])[i];
    const ctx = `agents[${String(i)}]`;
    if (!isPlainObject(raw)) {
      messages.push(err(ctx, "agent spec must be an object."));
      continue;
    }

    const kind = raw.kind;
    if (kind === "NEW") {
      const parsed = parseNewAgent(ctx, raw);
      if (parsed.error !== undefined) {
        messages.push(parsed.error);
      } else if (parsed.agent !== undefined) {
        if (seenAgentRefs.has(parsed.agent.ref)) {
          messages.push(err(ctx, `Duplicate agent ref '${parsed.agent.ref}'.`));
        } else {
          seenAgentRefs.add(parsed.agent.ref);
        }

        agents.push(parsed.agent);
      }
    } else if (kind === "EXISTING") {
      const parsed = parseExistingAgent(ctx, raw);
      if (parsed.error !== undefined) {
        messages.push(parsed.error);
      } else if (parsed.agent !== undefined) {
        if (seenAgentRefs.has(parsed.agent.ref)) {
          messages.push(err(ctx, `Duplicate agent ref '${parsed.agent.ref}'.`));
        } else {
          seenAgentRefs.add(parsed.agent.ref);
        }

        agents.push(parsed.agent);
      }
    } else {
      messages.push(err(ctx, "agent kind must be NEW or EXISTING."));
    }
  }

  const wf = workflow as Record<string, unknown>;
  const nodesRaw = wf.nodes;
  const edgesRaw = wf.edges;

  if (!Array.isArray(nodesRaw)) {
    messages.push("workflow.nodes must be an array.");
  } else if (
    nodesRaw.length === 0 ||
    nodesRaw.length > BUILDER_MAX_WORKFLOW_NODES
  ) {
    messages.push(
      `workflow.nodes must have 1–${String(BUILDER_MAX_WORKFLOW_NODES)} nodes.`,
    );
  }

  if (!Array.isArray(edgesRaw)) {
    messages.push("workflow.edges must be an array.");
  } else if (edgesRaw.length > BUILDER_MAX_WORKFLOW_EDGES) {
    messages.push(
      `workflow.edges must have at most ${String(BUILDER_MAX_WORKFLOW_EDGES)} edges.`,
    );
  }

  const parsedNodes: BuilderProposalWorkflowNodeIntentV1[] = [];
  const nodeKeys = new Set<string>();
  if (Array.isArray(nodesRaw)) {
    for (let i = 0; i < nodesRaw.length; i += 1) {
      const n = nodesRaw[i];
      const ctx = `workflow.nodes[${String(i)}]`;
      const parsed = parseWorkflowNode(ctx, n);
      if (parsed.error !== undefined) {
        messages.push(parsed.error);
      } else if (parsed.node !== undefined) {
        if (nodeKeys.has(parsed.node.key)) {
          messages.push(
            err(ctx, `Duplicate workflow node key '${parsed.node.key}'.`),
          );
        } else {
          nodeKeys.add(parsed.node.key);
        }

        parsedNodes.push(parsed.node);
      }
    }
  }

  const edges: WorkflowDefinitionEdgeV1[] = [];
  if (Array.isArray(edgesRaw)) {
    for (let i = 0; i < edgesRaw.length; i += 1) {
      const e = edgesRaw[i];
      const ctx = `workflow.edges[${String(i)}]`;
      if (!isPlainObject(e)) {
        messages.push(err(ctx, "edge must be an object."));
        continue;
      }

      if (typeof e.from !== "string" || e.from.length === 0) {
        messages.push(err(ctx, "from must be non-empty."));
        continue;
      }

      if (typeof e.to !== "string" || e.to.length === 0) {
        messages.push(err(ctx, "to must be non-empty."));
        continue;
      }

      edges.push({ from: e.from, to: e.to });
    }
  }

  if (messages.length > 0) {
    return { ok: false, messages: messages.sort((a, b) => a.localeCompare(b)) };
  }

  if (!isPlainObject(registry)) {
    return { ok: false, messages: ["workflowRegistry must be an object."] };
  }

  const proposal: BuilderProposalV1 = {
    schemaVersion: BUILDER_PROPOSAL_SCHEMA_VERSION,
    workflowRegistry: {
      key: (registry as { key: string }).key,
      name: (registry as { name: string }).name,
      ...(((registry as { description?: string }).description === undefined
        ? {}
        : {
            description: (registry as { description: string }).description,
          }) as {
        description?: string;
      }),
    },
    agents,
    workflow: { nodes: parsedNodes, edges },
    assumptions: assumptionsParsed.ok,
    unresolvedRequirements: unresolvedParsed.ok,
  };

  return { ok: true, proposal };
}

export type BuilderProposalParseResult =
  | { readonly ok: true; readonly proposal: BuilderProposalV1 }
  | { readonly ok: false; readonly messages: readonly string[] };
