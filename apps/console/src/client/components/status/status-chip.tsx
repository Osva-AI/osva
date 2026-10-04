import type { StatusVisualCategory } from "../../lib/statuses";

interface StatusChipProps {
  readonly status: string;
  readonly category: StatusVisualCategory;
}

export function StatusChip({ status, category }: StatusChipProps) {
  return (
    <span className={`status-chip status-${category}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}
