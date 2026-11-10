import type { JsonSchemaRecord } from "@osva-ai/contracts";

import { ANTHROPIC_RECORDS_ENCODING } from "./builder-proposal-anthropic-records.js";

const recordFields = {
  kind: { type: "string" },
  id: { type: "string" },
  role: { type: "string" },
  name: { type: "string" },
  label: { type: "string" },
  text: { type: "string" },
  ref: { type: "string" },
  ref2: { type: "string" },
  n1: { type: "integer" },
  n2: { type: "integer" },
  n3: { type: "integer" },
  n4: { type: "integer" },
  n5: { type: "integer" },
  flag: { type: "string" },
  flag2: { type: "string" },
  ord: { type: "integer" },
} as const;

const recordItem: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: { ...recordFields },
  required: Object.keys(recordFields),
};

/**
 * Anthropic `output_config.format.schema` for Builder generation.
 *
 * One homogeneous records array replaces typed-array IR and canonical anyOf
 * unions so compiled grammar stays small. Domain {@link parseBuilderProposalV1}
 * remains the canonical validator after decode.
 */
export const BuilderProposalAnthropicRecordsJsonSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    encoding: { type: "string" },
    records: { type: "array", items: recordItem },
  },
  required: ["encoding", "records"],
};

export const ANTHROPIC_RECORDS_PROMPT_SECTION = `STRUCTURED_OUTPUT_ENCODING: ${ANTHROPIC_RECORDS_ENCODING}
Emit encoding "${ANTHROPIC_RECORDS_ENCODING}" and a records array. Do not emit canonical BuilderProposalV1 object unions.
Every record has exactly these keys: kind, id, role, name, label, text, ref, ref2, n1, n2, n3, n4, n5, flag, flag2, ord.
Unused strings are empty. Unused integers are 0. Do not omit keys. Do not add keys. Do not use JSON-string blobs.
kind values:
- meta (exactly one): id=workflow key, name=workflow name, text=description or empty.
- agent: role NEW or EXISTING, id=bpr_ ref, ord=agent order.
  NEW: name=agentKey, label=agentName, text=instructions, ref=modelProfileVersionId, ref2=modelBindingName, n1=timeoutMs, n2=maxAttempts, n3=maxModelInvocations, n4=maxToolInvocations, n5=maxOutputTokens or 0 if absent, flag/flag2=unset|true|false for checkpointingEnabled/automaticRecoveryEnabled.
  EXISTING: ref=agentVersionId. Other unused fields empty/0.
- tool: id=agent ref, name=bindingName, ref=toolVersionId, ord=tool order.
- node: id=node key, ord=node order, role one of AGENT, BRANCH, PARALLEL, JOIN, APPROVAL, WAIT_DURATION, WAIT_UNTIL, WAIT_EVENT_LITERAL, WAIT_EVENT_POINTER.
  AGENT: ref=agent ref.
  BRANCH: text=selector, ref=defaultTo.
  APPROVAL: name=title, text=description or empty.
  WAIT_DURATION: n1=durationMs.
  WAIT_UNTIL: text=until instant.
  WAIT_EVENT_LITERAL: name=source, label=eventType, text=value, n5=timeoutMs or 0 if absent.
  WAIT_EVENT_POINTER: name=source, label=eventType, text=pointer, n5=timeoutMs or 0 if absent.
- case: id=BRANCH node key, role=string|number|boolean|null, text=equalsText (empty when null; true/false when boolean; decimal when number), ref=to, ord=case order.
- edge: id=from, ref=to, ord=edge order.
- note: role=assumption or unresolved, text=message, ord=order.`;
