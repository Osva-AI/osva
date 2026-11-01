import type { ReactNode } from "react";

interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong className="empty-state-title">{title}</strong>
      {description !== undefined ? (
        <p className="empty-state-description">{description}</p>
      ) : null}
      {action !== undefined ? (
        <div className="empty-state-action">{action}</div>
      ) : null}
    </div>
  );
}
