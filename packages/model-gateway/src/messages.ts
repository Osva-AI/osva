import type { ModelTextMessage } from "@osva/contracts";

export interface SplitModelMessagesResult {
  readonly systemContent: string;
  readonly conversation: readonly ModelTextMessage[];
}

export function splitSystemAndConversationMessages(
  messages: readonly ModelTextMessage[],
): SplitModelMessagesResult {
  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");

  return { systemContent, conversation };
}
