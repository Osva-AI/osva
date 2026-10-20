import type {
  ModelConversationMessage,
  ModelTextMessage,
} from "@osva-ai/contracts";

export interface SplitModelMessagesResult {
  readonly systemContent: string;
  readonly conversation: readonly ModelConversationMessage[];
}

export function splitSystemAndConversationMessages(
  messages: readonly ModelConversationMessage[],
): SplitModelMessagesResult {
  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");

  return { systemContent, conversation };
}

export function isModelTextMessage(
  message: ModelConversationMessage,
): message is ModelTextMessage {
  return (
    message.role === "system" ||
    message.role === "user" ||
    message.role === "assistant"
  );
}
