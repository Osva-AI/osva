interface LoadingBlockProps {
  readonly label?: string;
}

export function LoadingBlock({ label = "Loading…" }: LoadingBlockProps) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
