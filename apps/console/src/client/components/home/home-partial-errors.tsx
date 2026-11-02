import { InlineMessage } from "../ui/inline-message";

export function HomePartialErrors({
  messages,
}: {
  readonly messages: readonly string[];
}) {
  if (messages.length === 0) {
    return null;
  }
  return (
    <InlineMessage tone="warning" title="Partial data">
      <ul className="plain-list">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </InlineMessage>
  );
}
