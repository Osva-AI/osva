import type { ReactNode } from "react";

export type InlineMessageTone = "info" | "success" | "warning" | "error";

export interface InlineMessageProps {
  readonly tone?: InlineMessageTone;
  readonly title?: string;
  readonly children: ReactNode;
}

export function InlineMessage({
  tone = "info",
  title,
  children,
}: InlineMessageProps) {
  const role = tone === "error" ? "alert" : "status";

  return (
    <div className={`inline-message inline-message-${tone}`} role={role}>
      {title !== undefined ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}
