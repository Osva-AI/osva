import type { ReactNode } from "react";

export interface DataTableRegionProps {
  readonly caption?: string;
  readonly children: ReactNode;
}

export function DataTableRegion({ caption, children }: DataTableRegionProps) {
  return (
    <div className="table-scroll" tabIndex={0}>
      <table className="data-table">
        {caption !== undefined ? (
          <caption className="visually-hidden">{caption}</caption>
        ) : null}
        {children}
      </table>
    </div>
  );
}
