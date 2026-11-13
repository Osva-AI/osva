import type { ReactNode } from "react";

export interface SectionPanelProps {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SectionPanel({
  id,
  title,
  description,
  actions,
  children,
  className,
}: SectionPanelProps) {
  const panelClassName =
    className !== undefined && className.length > 0
      ? `panel ${className}`
      : "panel";

  return (
    <section id={id} className={panelClassName}>
      {title !== undefined || actions !== undefined ? (
        <div className="panel-header-row">
          <div>
            {title !== undefined ? (
              <h2 className="panel-title">{title}</h2>
            ) : null}
            {description !== undefined ? (
              <p className="panel-description muted">{description}</p>
            ) : null}
          </div>
          {actions !== undefined ? (
            <div className="panel-header-actions">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
