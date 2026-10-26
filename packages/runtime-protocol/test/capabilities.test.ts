import { describe, expect, it } from "vitest";

import { KNOWLEDGE_MAX_TOP_K } from "@osva-ai/contracts";

import {
  RUNTIME_MEMORY_LIST_MAX_ITEMS,
  runtimeKnowledgeSearchSuccessSchema,
  runtimeKnowledgeSearchRequestSchema,
  runtimeMemoryListSuccessSchema,
  runtimeModelGenerateTextRequestSchema,
  runtimeToolInvokeRequestSchema,
} from "../src/index.js";

const capabilitySuccessEnvelope = {
  protocolVersion: "1" as const,
  executionId: "attempt-1",
  outcome: "SUCCEEDED" as const,
};

function memoryListItem(index: number) {
  return {
    key: `k-${index}`,
    value: { n: index },
    revision: 1,
  };
}

function knowledgeSearchHit(index: number) {
  return {
    knowledgeChunkId: `knowledge-chunk-${index}`,
    knowledgeIndexId: "knowledge-index-1",
    knowledgeSourceId: "knowledge-source-1",
    artifactReference: {
      type: "artifact" as const,
      artifactId: "artifact-1",
    },
    text: `hit-${index}`,
    score: 0.9,
    attributes: {},
  };
}

describe("Runtime Protocol V1 capability schemas", () => {
  it("parses model and tool capability requests without version IDs", () => {
    const model = runtimeModelGenerateTextRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "primary",
      input: { messages: [{ role: "user", content: "hi" }] },
    });
    expect("modelProfileVersionId" in model).toBe(false);

    const tool = runtimeToolInvokeRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "echo",
      input: { hello: "world" },
      idempotencyKey: "side-effect-1",
    });
    expect("toolVersionId" in tool).toBe(false);

    const knowledge = runtimeKnowledgeSearchRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "docs",
      query: "hello",
      topK: 5,
    });
    expect("knowledgeIndexIds" in knowledge).toBe(false);
  });

  it("rejects malformed capability requests", () => {
    expect(
      runtimeModelGenerateTextRequestSchema.safeParse({
        protocolVersion: "1",
        executionId: "attempt-1",
        bindingName: "primary",
        input: { messages: [] },
      }).success,
    ).toBe(false);

    expect(
      runtimeToolInvokeRequestSchema.safeParse({
        protocolVersion: "1",
        executionId: "attempt-1",
        bindingName: "not a name",
        input: {},
      }).success,
    ).toBe(false);
  });

  it("accepts memory list success responses at the list item limit", () => {
    const items = Array.from(
      { length: RUNTIME_MEMORY_LIST_MAX_ITEMS },
      (_, i) => memoryListItem(i),
    );
    expect(
      runtimeMemoryListSuccessSchema.safeParse({
        ...capabilitySuccessEnvelope,
        items,
      }).success,
    ).toBe(true);
  });

  it("rejects memory list success responses over the list item limit", () => {
    const items = Array.from(
      { length: RUNTIME_MEMORY_LIST_MAX_ITEMS + 1 },
      (_, i) => memoryListItem(i),
    );
    expect(
      runtimeMemoryListSuccessSchema.safeParse({
        ...capabilitySuccessEnvelope,
        items,
      }).success,
    ).toBe(false);
  });

  it("accepts knowledge search success responses at KNOWLEDGE_MAX_TOP_K hits", () => {
    const hits = Array.from({ length: KNOWLEDGE_MAX_TOP_K }, (_, i) =>
      knowledgeSearchHit(i),
    );
    expect(
      runtimeKnowledgeSearchSuccessSchema.safeParse({
        ...capabilitySuccessEnvelope,
        hits,
      }).success,
    ).toBe(true);
  });

  it("rejects knowledge search success responses over KNOWLEDGE_MAX_TOP_K hits", () => {
    const hits = Array.from({ length: KNOWLEDGE_MAX_TOP_K + 1 }, (_, i) =>
      knowledgeSearchHit(i),
    );
    expect(
      runtimeKnowledgeSearchSuccessSchema.safeParse({
        ...capabilitySuccessEnvelope,
        hits,
      }).success,
    ).toBe(false);
  });
});
