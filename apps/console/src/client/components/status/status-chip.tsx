import type { StatusVisualCategory } from "../../lib/statuses";

interface StatusChipProps {
  readonly status: string;
  readonly category: StatusVisualCategory;
  readonly label?: string;
}

export function StatusChip({ status, category, label }: StatusChipProps) {
  const accessibleLabel = label ?? status;

  return (
    <span
      className={`status-chip status-${category}`}
      role="status"
      {...(label !== undefined ? { "aria-label": accessibleLabel } : {})}
    >
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
