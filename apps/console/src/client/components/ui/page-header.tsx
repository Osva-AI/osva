import type { ReactNode } from "react";

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle !== undefined ? (
          <p className="page-subtitle">{subtitle}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="toolbar">{actions}</div> : null}
    </header>
  );
}
