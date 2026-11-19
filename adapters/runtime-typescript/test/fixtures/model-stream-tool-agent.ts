export async function run(context: {
  readonly models: {
    generateCompletionStream(
      binding: string,
      request: {
        readonly messages: readonly {
          readonly role: "system" | "user" | "assistant";
          readonly content: string;
        }[];
        readonly toolDefinitions?: readonly {
          readonly name: string;
          readonly inputSchema: unknown;
        }[];
      },
    ): AsyncIterable<{
      readonly kind: string;
      readonly toolCallId?: string;
      readonly name?: string;
      readonly toolCallIndex?: number;
      readonly argumentsDelta?: string;
    }>;
  };
}): Promise<{
  readonly toolCallIds: string[];
  readonly toolNames: string[];
  readonly argumentDeltas: string[];
}> {
  const toolCallIds: string[] = [];
  const toolNames: string[] = [];
  const argumentDeltas: string[] = [];

  for await (const event of context.models.generateCompletionStream("primary", {
    messages: [{ role: "user", content: "declarative-tool-flow" }],
    toolDefinitions: [
      {
        name: "echo",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    ],
  })) {
    if (event.kind === "TOOL_CALL_START") {
      if (event.toolCallId !== undefined) {
        toolCallIds.push(event.toolCallId);
      }
      if (event.name !== undefined) {
        toolNames.push(event.name);
      }
    }
    if (
      event.kind === "TOOL_CALL_ARGUMENTS_DELTA" &&
      event.argumentsDelta !== undefined
    ) {
      argumentDeltas.push(event.argumentsDelta);
    }
  }

  return { toolCallIds, toolNames, argumentDeltas };
}
