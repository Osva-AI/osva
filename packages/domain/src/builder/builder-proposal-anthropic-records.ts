import type {
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
  BuilderProposalWorkflowNodeIntentV1,
} from "./builder-proposal.js";

/**
 * Anthropic Messages structured-output encoding for Builder generation (V2).
 *
 * Typed-array compact IR (`anthropic_compact_v1`) was still rejected with
 * compiled_grammar_too_large (17 object nodes). JSON-string configs were
 * rejected: they drop constrained generation, still consume output tokens, and
 * shift invalid structure into unconstrained text. This encoding uses one
 * homogeneous records array of primitives so the provider schema has two
 * object nodes and no unions.
 *
 * Unused strings are empty. Unused integers are 0. Missing keys, extra keys,
 * unknown kinds, and populated unused fields fail closed. Canonical
 * {@link parseBuilderProposalV1} remains authoritative after decode.
 */
export const ANTHROPIC_RECORDS_ENCODING = "anthropic_records_v1" as const;

const RECORD_KEYS = [
  "kind",
  "id",
  "role",
  "name",
  "label",
  "text",
  "ref",
  "ref2",
  "n1",
  "n2",
  "n3",
  "n4",
  "n5",
  "flag",
  "flag2",
  "ord",
] as const;

const ROOT_KEYS = ["encoding", "records"] as const;

const KIND_META = "meta";
const KIND_AGENT = "agent";
const KIND_TOOL = "tool";
const KIND_NODE = "node";
const KIND_CASE = "case";
const KIND_EDGE = "edge";
const KIND_NOTE = "note";

const NODE_ROLES = [
  "AGENT",
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "APPROVAL",
  "WAIT_DURATION",
  "WAIT_UNTIL",
  "WAIT_EVENT_LITERAL",
  "WAIT_EVENT_POINTER",
] as const;

const EQUALS_KINDS = ["string", "number", "boolean", "null"] as const;
const NOTE_ROLES = ["assumption", "unresolved"] as const;
const OPTIONAL_BOOL = ["unset", "true", "false"] as const;

export type DecodeBuilderProposalProviderOutputResult =
  | { readonly ok: true; readonly proposal: unknown }
  | { readonly ok: false; readonly messages: readonly string[] };

type RecordFields = {
  kind: string;
  id: string;
  role: string;
  name: string;
  label: string;
  text: string;
  ref: string;
  ref2: string;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  flag: string;
  flag2: string;
  ord: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(
  messages: readonly string[],
): DecodeBuilderProposalProviderOutputResult {
  return { ok: false, messages };
}

function unexpectedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  ctx: string,
): string | undefined {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (extra.length === 0) {
    return undefined;
  }
  extra.sort((a, b) => a.localeCompare(b));
  return `${ctx}: unexpected properties: ${extra.join(", ")}.`;
}

function readRecord(
  value: unknown,
  ctx: string,
): { ok: true; record: RecordFields } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return { ok: false, error: `${ctx} must be an object.` };
  }
  const extra = unexpectedKeys(value, RECORD_KEYS, ctx);
  if (extra !== undefined) {
    return { ok: false, error: extra };
  }
  const strings: Array<keyof RecordFields> = [
    "kind",
    "id",
    "role",
    "name",
    "label",
    "text",
    "ref",
    "ref2",
    "flag",
    "flag2",
  ];
  const ints: Array<keyof RecordFields> = ["n1", "n2", "n3", "n4", "n5", "ord"];
  const out: Record<string, unknown> = {};
  for (const key of strings) {
    const field = value[key];
    if (typeof field !== "string") {
      return { ok: false, error: `${ctx}.${key} must be a string.` };
    }
    out[key] = field;
  }
  for (const key of ints) {
    const field = value[key];
    if (typeof field !== "number" || !Number.isInteger(field)) {
      return { ok: false, error: `${ctx}.${key} must be an integer.` };
    }
    out[key] = field;
  }
  return { ok: true, record: out as RecordFields };
}

function populatedUnused(
  record: RecordFields,
  allowed: ReadonlySet<string>,
  ctx: string,
): string | undefined {
  const extra: string[] = [];
  for (const key of RECORD_KEYS) {
    if (key === "kind" || allowed.has(key)) {
      continue;
    }
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      extra.push(key);
    }
    if (typeof value === "number" && value !== 0) {
      extra.push(key);
    }
  }
  if (extra.length === 0) {
    return undefined;
  }
  extra.sort((a, b) => a.localeCompare(b));
  return `${ctx}: unused fields must be empty/0: ${extra.join(", ")}.`;
}

function requireNonempty(
  value: string,
  ctx: string,
  field: string,
): string | undefined {
  if (value.length === 0) {
    return `${ctx}.${field} is required.`;
  }
  return undefined;
}

function optionalBoolFromRecord(
  value: string,
  ctx: string,
): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (value === "unset") {
    return { ok: true, value: undefined };
  }
  if (value === "true") {
    return { ok: true, value: true };
  }
  if (value === "false") {
    return { ok: true, value: false };
  }
  return {
    ok: false,
    error: `${ctx} must be unset, true, or false.`,
  };
}

function compactFromOptionalBool(value: boolean | undefined): string {
  if (value === undefined) {
    return "unset";
  }
  return value ? "true" : "false";
}

function decodeEquals(
  kind: string,
  text: string,
  ctx: string,
):
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; error: string } {
  if (kind === "string") {
    return { ok: true, value: text };
  }
  if (kind === "null") {
    if (text.length !== 0) {
      return {
        ok: false,
        error: `${ctx}: equalsKind null requires empty equalsText.`,
      };
    }
    return { ok: true, value: null };
  }
  if (kind === "boolean") {
    if (text === "true") {
      return { ok: true, value: true };
    }
    if (text === "false") {
      return { ok: true, value: false };
    }
    return {
      ok: false,
      error: `${ctx}: equalsKind boolean requires equalsText true or false.`,
    };
  }
  if (kind === "number") {
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) {
      return {
        ok: false,
        error: `${ctx}: equalsKind number requires decimal equalsText.`,
      };
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return { ok: false, error: `${ctx}: equalsText is not a finite number.` };
    }
    return { ok: true, value: parsed };
  }
  return {
    ok: false,
    error: `${ctx}: equalsKind must be string, number, boolean, or null.`,
  };
}

function encodeEquals(value: string | number | boolean | null): {
  role: string;
  text: string;
} {
  if (value === null) {
    return { role: "null", text: "" };
  }
  if (typeof value === "boolean") {
    return { role: "boolean", text: value ? "true" : "false" };
  }
  if (typeof value === "number") {
    return { role: "number", text: JSON.stringify(value) };
  }
  return { role: "string", text: value };
}

function blankRecord(
  kind: string,
  overrides: Partial<RecordFields>,
): RecordFields {
  return {
    kind,
    id: "",
    role: "",
    name: "",
    label: "",
    text: "",
    ref: "",
    ref2: "",
    n1: 0,
    n2: 0,
    n3: 0,
    n4: 0,
    n5: 0,
    flag: "",
    flag2: "",
    ord: 0,
    ...overrides,
  };
}

/**
 * Maps Anthropic records IR or canonical Builder JSON onto the canonical
 * untrusted document. Canonical {@link parseBuilderProposalV1} remains
 * authoritative after this step.
 */
export function decodeBuilderProposalProviderOutput(
  value: unknown,
): DecodeBuilderProposalProviderOutputResult {
  if (!isPlainObject(value)) {
    return fail(["Provider output must be a JSON object."]);
  }
  const encoding = value.encoding;
  if (encoding === undefined) {
    return { ok: true, proposal: value };
  }
  if (encoding !== ANTHROPIC_RECORDS_ENCODING) {
    return fail([
      `Unsupported structured-output encoding '${String(encoding)}'.`,
    ]);
  }
  return decodeRecords(value);
}

function decodeRecords(
  root: Record<string, unknown>,
): DecodeBuilderProposalProviderOutputResult {
  const extra = unexpectedKeys(root, ROOT_KEYS, "anthropic_records_v1");
  if (extra !== undefined) {
    return fail([extra]);
  }
  if (!Array.isArray(root.records)) {
    return fail(["anthropic_records_v1.records must be an array."]);
  }

  const messages: string[] = [];
  let meta: { key: string; name: string; description: string } | undefined;
  const agents: Array<{
    ord: number;
    ref: string;
    spec: Record<string, unknown>;
  }> = [];
  const tools: Array<{
    ord: number;
    agentRef: string;
    bindingName: string;
    toolVersionId: string;
  }> = [];
  const nodes: Array<{
    ord: number;
    key: string;
    role: string;
    node: Record<string, unknown>;
  }> = [];
  const cases: Array<{
    ord: number;
    branchKey: string;
    equals: string | number | boolean | null;
    to: string;
  }> = [];
  const edges: Array<{ ord: number; from: string; to: string }> = [];
  const assumptions: Array<{ ord: number; text: string }> = [];
  const unresolved: Array<{ ord: number; text: string }> = [];

  for (let i = 0; i < root.records.length; i += 1) {
    const ctx = `records[${String(i)}]`;
    const parsed = readRecord(root.records[i], ctx);
    if (!parsed.ok) {
      messages.push(parsed.error);
      continue;
    }
    const rec = parsed.record;
    switch (rec.kind) {
      case KIND_META: {
        const error = decodeMeta(rec, ctx);
        if (error !== undefined) {
          messages.push(error);
          break;
        }
        if (meta !== undefined) {
          messages.push(`${ctx}: duplicate meta record.`);
          break;
        }
        meta = { key: rec.id, name: rec.name, description: rec.text };
        break;
      }
      case KIND_AGENT: {
        const decoded = decodeAgent(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        agents.push(decoded.value);
        break;
      }
      case KIND_TOOL: {
        const decoded = decodeTool(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        tools.push(decoded.value);
        break;
      }
      case KIND_NODE: {
        const decoded = decodeNode(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        nodes.push(decoded.value);
        break;
      }
      case KIND_CASE: {
        const decoded = decodeCase(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        cases.push(decoded.value);
        break;
      }
      case KIND_EDGE: {
        const decoded = decodeEdge(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        edges.push(decoded.value);
        break;
      }
      case KIND_NOTE: {
        const decoded = decodeNote(rec, ctx);
        if (!decoded.ok) {
          messages.push(decoded.error);
          break;
        }
        if (decoded.value.role === "assumption") {
          assumptions.push({
            ord: decoded.value.ord,
            text: decoded.value.text,
          });
        } else {
          unresolved.push({
            ord: decoded.value.ord,
            text: decoded.value.text,
          });
        }
        break;
      }
      default:
        messages.push(`${ctx}: unknown record kind '${rec.kind}'.`);
    }
  }

  if (meta === undefined) {
    messages.push("anthropic_records_v1: missing meta record.");
  }

  const agentOrds = new Set<number>();
  for (const agent of agents) {
    if (agentOrds.has(agent.ord)) {
      messages.push(
        `anthropic_records_v1: duplicate agent ord ${String(agent.ord)}.`,
      );
    }
    agentOrds.add(agent.ord);
  }
  const agentRefs = new Set(agents.map((agent) => agent.ref));
  const seenAgentRefs = new Set<string>();
  for (const agent of agents) {
    if (seenAgentRefs.has(agent.ref)) {
      messages.push(
        `anthropic_records_v1: duplicate agent ref '${agent.ref}'.`,
      );
    }
    seenAgentRefs.add(agent.ref);
  }

  for (const tool of tools) {
    if (!agentRefs.has(tool.agentRef)) {
      messages.push(
        `anthropic_records_v1: tool references unknown agent '${tool.agentRef}'.`,
      );
    }
  }

  const nodeOrds = new Set<number>();
  const nodesByKey = new Map<string, (typeof nodes)[number]>();
  for (const node of nodes) {
    if (nodeOrds.has(node.ord)) {
      messages.push(
        `anthropic_records_v1: duplicate node ord ${String(node.ord)}.`,
      );
    }
    nodeOrds.add(node.ord);
    if (nodesByKey.has(node.key)) {
      messages.push(`anthropic_records_v1: duplicate node key '${node.key}'.`);
    }
    nodesByKey.set(node.key, node);
  }

  const casesByBranch = new Map<string, typeof cases>();
  for (const item of cases) {
    const node = nodesByKey.get(item.branchKey);
    if (node === undefined) {
      messages.push(
        `anthropic_records_v1: case references unknown node '${item.branchKey}'.`,
      );
      continue;
    }
    if (node.role !== "BRANCH") {
      messages.push(
        `anthropic_records_v1: case '${item.branchKey}' is not a BRANCH node.`,
      );
      continue;
    }
    const list = casesByBranch.get(item.branchKey) ?? [];
    list.push(item);
    casesByBranch.set(item.branchKey, list);
  }

  if (messages.length > 0) {
    return fail(messages);
  }

  const toolsByAgent = new Map<string, typeof tools>();
  for (const tool of tools) {
    const list = toolsByAgent.get(tool.agentRef) ?? [];
    list.push(tool);
    toolsByAgent.set(tool.agentRef, list);
  }

  const agentSpecs = [...agents]
    .sort((a, b) => a.ord - b.ord)
    .map((agent) => {
      if (agent.spec.kind === "NEW") {
        const attached = [...(toolsByAgent.get(agent.ref) ?? [])].sort(
          (a, b) => a.ord - b.ord,
        );
        return {
          ...agent.spec,
          tools: attached.map((tool) => ({
            bindingName: tool.bindingName,
            toolVersionId: tool.toolVersionId,
          })),
        };
      }
      if ((toolsByAgent.get(agent.ref) ?? []).length > 0) {
        messages.push(
          `anthropic_records_v1: EXISTING agent '${agent.ref}' cannot have tool records.`,
        );
      }
      return agent.spec;
    });

  if (messages.length > 0) {
    return fail(messages);
  }

  const nodeObjects = [...nodes]
    .sort((a, b) => a.ord - b.ord)
    .map((node) => {
      if (node.role === "BRANCH") {
        const branchCases = [...(casesByBranch.get(node.key) ?? [])].sort(
          (a, b) => a.ord - b.ord,
        );
        return {
          ...node.node,
          cases: branchCases.map((item) => ({
            equals: item.equals,
            to: item.to,
          })),
        };
      }
      return node.node;
    });

  const edgeObjects = [...edges]
    .sort((a, b) => a.ord - b.ord)
    .map((edge) => ({ from: edge.from, to: edge.to }));

  const assumptionStrings = [...assumptions]
    .sort((a, b) => a.ord - b.ord)
    .map((item) => item.text);
  const unresolvedStrings = [...unresolved]
    .sort((a, b) => a.ord - b.ord)
    .map((item) => item.text);

  return {
    ok: true,
    proposal: {
      schemaVersion: "1",
      workflowRegistry: {
        key: meta!.key,
        name: meta!.name,
        ...(meta!.description.length > 0
          ? { description: meta!.description }
          : {}),
      },
      agents: agentSpecs,
      workflow: {
        nodes: nodeObjects,
        edges: edgeObjects,
      },
      assumptions: assumptionStrings,
      unresolvedRequirements: unresolvedStrings,
    },
  };
}

function decodeMeta(rec: RecordFields, ctx: string): string | undefined {
  const unused = populatedUnused(rec, new Set(["id", "name", "text"]), ctx);
  if (unused !== undefined) {
    return unused;
  }
  return (
    requireNonempty(rec.id, ctx, "id") ?? requireNonempty(rec.name, ctx, "name")
  );
}

function decodeAgent(
  rec: RecordFields,
  ctx: string,
):
  | {
      ok: true;
      value: { ord: number; ref: string; spec: Record<string, unknown> };
    }
  | { ok: false; error: string } {
  if (rec.role === "EXISTING") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "ref", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    const missing =
      requireNonempty(rec.id, ctx, "id") ??
      requireNonempty(rec.ref, ctx, "ref");
    if (missing !== undefined) {
      return { ok: false, error: missing };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        ref: rec.id,
        spec: { kind: "EXISTING", ref: rec.id, agentVersionId: rec.ref },
      },
    };
  }
  if (rec.role !== "NEW") {
    return {
      ok: false,
      error: `${ctx}.role must be NEW or EXISTING.`,
    };
  }
  const unused = populatedUnused(
    rec,
    new Set([
      "id",
      "role",
      "name",
      "label",
      "text",
      "ref",
      "ref2",
      "n1",
      "n2",
      "n3",
      "n4",
      "n5",
      "flag",
      "flag2",
      "ord",
    ]),
    ctx,
  );
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  const missing =
    requireNonempty(rec.id, ctx, "id") ??
    requireNonempty(rec.name, ctx, "name") ??
    requireNonempty(rec.label, ctx, "label") ??
    requireNonempty(rec.text, ctx, "text") ??
    requireNonempty(rec.ref, ctx, "ref") ??
    requireNonempty(rec.ref2, ctx, "ref2");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  if (!OPTIONAL_BOOL.includes(rec.flag as (typeof OPTIONAL_BOOL)[number])) {
    return {
      ok: false,
      error: `${ctx}.flag must be unset, true, or false.`,
    };
  }
  if (!OPTIONAL_BOOL.includes(rec.flag2 as (typeof OPTIONAL_BOOL)[number])) {
    return {
      ok: false,
      error: `${ctx}.flag2 must be unset, true, or false.`,
    };
  }
  const checkpointing = optionalBoolFromRecord(rec.flag, `${ctx}.flag`);
  const recovery = optionalBoolFromRecord(rec.flag2, `${ctx}.flag2`);
  if (!checkpointing.ok) {
    return { ok: false, error: checkpointing.error };
  }
  if (!recovery.ok) {
    return { ok: false, error: recovery.error };
  }
  const execution: Record<string, unknown> = {
    timeoutMs: rec.n1,
    maxAttempts: rec.n2,
    maxModelInvocations: rec.n3,
    maxToolInvocations: rec.n4,
  };
  if (rec.n5 !== 0) {
    execution.maxOutputTokens = rec.n5;
  }
  if (checkpointing.value !== undefined) {
    execution.checkpointingEnabled = checkpointing.value;
  }
  if (recovery.value !== undefined) {
    execution.automaticRecoveryEnabled = recovery.value;
  }
  return {
    ok: true,
    value: {
      ord: rec.ord,
      ref: rec.id,
      spec: {
        kind: "NEW",
        ref: rec.id,
        agentKey: rec.name,
        agentName: rec.label,
        instructions: rec.text,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        modelBindingName: rec.ref2,
        model: {
          bindingName: rec.ref2,
          modelProfileVersionId: rec.ref,
        },
        tools: [],
        execution,
      },
    },
  };
}

function decodeTool(
  rec: RecordFields,
  ctx: string,
):
  | {
      ok: true;
      value: {
        ord: number;
        agentRef: string;
        bindingName: string;
        toolVersionId: string;
      };
    }
  | { ok: false; error: string } {
  const unused = populatedUnused(
    rec,
    new Set(["id", "name", "ref", "ord"]),
    ctx,
  );
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  const missing =
    requireNonempty(rec.id, ctx, "id") ??
    requireNonempty(rec.name, ctx, "name") ??
    requireNonempty(rec.ref, ctx, "ref");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  return {
    ok: true,
    value: {
      ord: rec.ord,
      agentRef: rec.id,
      bindingName: rec.name,
      toolVersionId: rec.ref,
    },
  };
}

function decodeNode(
  rec: RecordFields,
  ctx: string,
):
  | {
      ok: true;
      value: {
        ord: number;
        key: string;
        role: string;
        node: Record<string, unknown>;
      };
    }
  | { ok: false; error: string } {
  if (!NODE_ROLES.includes(rec.role as (typeof NODE_ROLES)[number])) {
    return { ok: false, error: `${ctx}: unknown node type '${rec.role}'.` };
  }
  const missingId = requireNonempty(rec.id, ctx, "id");
  if (missingId !== undefined) {
    return { ok: false, error: missingId };
  }
  if (rec.role === "AGENT") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "ref", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    const missing = requireNonempty(rec.ref, ctx, "ref");
    if (missing !== undefined) {
      return { ok: false, error: missing };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: { key: rec.id, type: "AGENT", agentRef: rec.ref },
      },
    };
  }
  if (rec.role === "BRANCH") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "text", "ref", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    const missing =
      requireNonempty(rec.text, ctx, "text") ??
      requireNonempty(rec.ref, ctx, "ref");
    if (missing !== undefined) {
      return { ok: false, error: missing };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: {
          key: rec.id,
          type: "BRANCH",
          selector: rec.text,
          defaultTo: rec.ref,
          cases: [],
        },
      },
    };
  }
  if (rec.role === "PARALLEL" || rec.role === "JOIN") {
    const unused = populatedUnused(rec, new Set(["id", "role", "ord"]), ctx);
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: { key: rec.id, type: rec.role },
      },
    };
  }
  if (rec.role === "APPROVAL") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "name", "text", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    const missing = requireNonempty(rec.name, ctx, "name");
    if (missing !== undefined) {
      return { ok: false, error: missing };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: {
          key: rec.id,
          type: "APPROVAL",
          title: rec.name,
          ...(rec.text.length > 0 ? { description: rec.text } : {}),
        },
      },
    };
  }
  if (rec.role === "WAIT_DURATION") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "n1", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    if (rec.n1 === 0) {
      return { ok: false, error: `${ctx}.n1 (durationMs) is required.` };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: {
          key: rec.id,
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: rec.n1 },
        },
      },
    };
  }
  if (rec.role === "WAIT_UNTIL") {
    const unused = populatedUnused(
      rec,
      new Set(["id", "role", "text", "ord"]),
      ctx,
    );
    if (unused !== undefined) {
      return { ok: false, error: unused };
    }
    const missing = requireNonempty(rec.text, ctx, "text");
    if (missing !== undefined) {
      return { ok: false, error: missing };
    }
    return {
      ok: true,
      value: {
        ord: rec.ord,
        key: rec.id,
        role: rec.role,
        node: {
          key: rec.id,
          type: "WAIT",
          wait: { kind: "UNTIL", until: rec.text },
        },
      },
    };
  }
  const unused = populatedUnused(
    rec,
    new Set(["id", "role", "name", "label", "text", "n5", "ord"]),
    ctx,
  );
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  const missing =
    requireNonempty(rec.name, ctx, "name") ??
    requireNonempty(rec.label, ctx, "label") ??
    requireNonempty(rec.text, ctx, "text");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  const wait: Record<string, unknown> = {
    kind: "EVENT",
    source: rec.name,
    eventType: rec.label,
    correlation:
      rec.role === "WAIT_EVENT_LITERAL"
        ? { kind: "LITERAL", value: rec.text }
        : { kind: "INPUT_POINTER", pointer: rec.text },
  };
  if (rec.n5 !== 0) {
    wait.timeoutMs = rec.n5;
  }
  return {
    ok: true,
    value: {
      ord: rec.ord,
      key: rec.id,
      role: rec.role,
      node: { key: rec.id, type: "WAIT", wait },
    },
  };
}

function decodeCase(
  rec: RecordFields,
  ctx: string,
):
  | {
      ok: true;
      value: {
        ord: number;
        branchKey: string;
        equals: string | number | boolean | null;
        to: string;
      };
    }
  | { ok: false; error: string } {
  const unused = populatedUnused(
    rec,
    new Set(["id", "role", "text", "ref", "ord"]),
    ctx,
  );
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  if (!EQUALS_KINDS.includes(rec.role as (typeof EQUALS_KINDS)[number])) {
    return {
      ok: false,
      error: `${ctx}.role must be string, number, boolean, or null.`,
    };
  }
  const missing =
    requireNonempty(rec.id, ctx, "id") ?? requireNonempty(rec.ref, ctx, "ref");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  const decoded = decodeEquals(rec.role, rec.text, ctx);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error };
  }
  return {
    ok: true,
    value: {
      ord: rec.ord,
      branchKey: rec.id,
      equals: decoded.value,
      to: rec.ref,
    },
  };
}

function decodeEdge(
  rec: RecordFields,
  ctx: string,
):
  | { ok: true; value: { ord: number; from: string; to: string } }
  | { ok: false; error: string } {
  const unused = populatedUnused(rec, new Set(["id", "ref", "ord"]), ctx);
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  const missing =
    requireNonempty(rec.id, ctx, "id") ?? requireNonempty(rec.ref, ctx, "ref");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  return {
    ok: true,
    value: { ord: rec.ord, from: rec.id, to: rec.ref },
  };
}

function decodeNote(
  rec: RecordFields,
  ctx: string,
):
  | {
      ok: true;
      value: { ord: number; role: "assumption" | "unresolved"; text: string };
    }
  | { ok: false; error: string } {
  const unused = populatedUnused(rec, new Set(["role", "text", "ord"]), ctx);
  if (unused !== undefined) {
    return { ok: false, error: unused };
  }
  if (!NOTE_ROLES.includes(rec.role as (typeof NOTE_ROLES)[number])) {
    return {
      ok: false,
      error: `${ctx}.role must be assumption or unresolved.`,
    };
  }
  const missing = requireNonempty(rec.text, ctx, "text");
  if (missing !== undefined) {
    return { ok: false, error: missing };
  }
  return {
    ok: true,
    value: {
      ord: rec.ord,
      role: rec.role as "assumption" | "unresolved",
      text: rec.text,
    },
  };
}

/** Deterministic records IR for tests and Anthropic refinement prompts. */
export function encodeBuilderProposalAsAnthropicRecords(
  proposal: BuilderProposalV1,
): Record<string, unknown> {
  const records: RecordFields[] = [
    blankRecord(KIND_META, {
      id: proposal.workflowRegistry.key,
      name: proposal.workflowRegistry.name,
      text: proposal.workflowRegistry.description ?? "",
    }),
  ];

  proposal.agents.forEach((agent, agentIndex) => {
    if (agent.kind === "NEW") {
      records.push(encodeNewAgent(agent, agentIndex));
      agent.tools.forEach((tool, toolIndex) => {
        records.push(
          blankRecord(KIND_TOOL, {
            id: agent.ref,
            name: tool.bindingName,
            ref: tool.toolVersionId,
            ord: toolIndex,
          }),
        );
      });
    } else {
      records.push(
        blankRecord(KIND_AGENT, {
          id: agent.ref,
          role: "EXISTING",
          ref: agent.agentVersionId,
          ord: agentIndex,
        }),
      );
    }
  });

  proposal.workflow.nodes.forEach((node, nodeIndex) => {
    records.push(...encodeNode(node, nodeIndex));
  });

  proposal.workflow.edges.forEach((edge, edgeIndex) => {
    records.push(
      blankRecord(KIND_EDGE, {
        id: edge.from,
        ref: edge.to,
        ord: edgeIndex,
      }),
    );
  });

  proposal.assumptions.forEach((text, index) => {
    records.push(
      blankRecord(KIND_NOTE, {
        role: "assumption",
        text,
        ord: index,
      }),
    );
  });
  proposal.unresolvedRequirements.forEach((text, index) => {
    records.push(
      blankRecord(KIND_NOTE, {
        role: "unresolved",
        text,
        ord: index,
      }),
    );
  });

  return {
    encoding: ANTHROPIC_RECORDS_ENCODING,
    records,
  };
}

function encodeNewAgent(
  agent: BuilderProposalNewAgentV1,
  ord: number,
): RecordFields {
  return blankRecord(KIND_AGENT, {
    id: agent.ref,
    role: "NEW",
    name: agent.agentKey,
    label: agent.agentName,
    text: agent.instructions,
    ref: agent.model.modelProfileVersionId,
    ref2: agent.modelBindingName,
    n1: agent.execution.timeoutMs,
    n2: agent.execution.maxAttempts,
    n3: agent.execution.maxModelInvocations,
    n4: agent.execution.maxToolInvocations,
    n5: agent.execution.maxOutputTokens ?? 0,
    flag: compactFromOptionalBool(agent.execution.checkpointingEnabled),
    flag2: compactFromOptionalBool(agent.execution.automaticRecoveryEnabled),
    ord,
  });
}

function encodeNode(
  node: BuilderProposalWorkflowNodeIntentV1,
  ord: number,
): RecordFields[] {
  if (node.type === "AGENT") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "AGENT",
        ref: node.agentRef,
        ord,
      }),
    ];
  }
  if (node.type === "BRANCH") {
    const records = [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "BRANCH",
        text: node.selector,
        ref: node.defaultTo,
        ord,
      }),
    ];
    node.cases.forEach((item, caseIndex) => {
      const encoded = encodeEquals(item.equals);
      records.push(
        blankRecord(KIND_CASE, {
          id: node.key,
          role: encoded.role,
          text: encoded.text,
          ref: item.to,
          ord: caseIndex,
        }),
      );
    });
    return records;
  }
  if (node.type === "PARALLEL" || node.type === "JOIN") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: node.type,
        ord,
      }),
    ];
  }
  if (node.type === "APPROVAL") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "APPROVAL",
        name: node.title,
        text: node.description ?? "",
        ord,
      }),
    ];
  }
  if (node.wait.kind === "DURATION") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "WAIT_DURATION",
        n1: node.wait.durationMs,
        ord,
      }),
    ];
  }
  if (node.wait.kind === "UNTIL") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "WAIT_UNTIL",
        text: node.wait.until,
        ord,
      }),
    ];
  }
  if (node.wait.correlation.kind === "LITERAL") {
    return [
      blankRecord(KIND_NODE, {
        id: node.key,
        role: "WAIT_EVENT_LITERAL",
        name: node.wait.source,
        label: node.wait.eventType,
        text: node.wait.correlation.value,
        n5: node.wait.timeoutMs ?? 0,
        ord,
      }),
    ];
  }
  return [
    blankRecord(KIND_NODE, {
      id: node.key,
      role: "WAIT_EVENT_POINTER",
      name: node.wait.source,
      label: node.wait.eventType,
      text: node.wait.correlation.pointer,
      n5: node.wait.timeoutMs ?? 0,
      ord,
    }),
  ];
}
