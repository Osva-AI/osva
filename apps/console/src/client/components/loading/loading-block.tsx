interface LoadingBlockProps {
  readonly label?: string;
}

export function LoadingBlock({ label = "Loading…" }: LoadingBlockProps) {
  return <div className="empty-state">{label}</div>;
}
