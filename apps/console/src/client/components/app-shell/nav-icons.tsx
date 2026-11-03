import type { ReactNode } from "react";

interface IconProps {
  readonly className?: string;
}

function Svg({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function NavIconHome({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function NavIconAgents({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="7" width="16" height="13" rx="3" />
      <path d="M12 3v4M8 3h8M8 13h.01M16 13h.01M9 17h6" />
    </Svg>
  );
}

export function NavIconWorkflows({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="3" width="8" height="6" rx="1" />
      <rect x="14" y="15" width="8" height="6" rx="1" />
      <path d="M6 9v3a3 3 0 0 0 3 3h5M14 18H9a3 3 0 0 1-3-3" />
    </Svg>
  );
}

export function NavIconActivity({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Svg>
  );
}

export function NavIconTesting({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 3h6m-5 0v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L14 9V3M7 16h10" />
    </Svg>
  );
}

export function NavIconResources({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m12 2 8 4.5V16l-8 4.5L4 16V6.5L12 2Zm0 9L4 6.5m8 4.5 8-4.5M12 11v9.5" />
    </Svg>
  );
}

export function NavIconModels({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5M9 9h6v6H9z" />
    </Svg>
  );
}

export function NavIconTools({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m8 7 4 4m-7 2 6 6m2-14 6 6m-7 7-4 4M14 2l8 8-7 7-8-8 7-7Z" />
    </Svg>
  );
}

export function NavIconKnowledge({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 7v14M3 5a12 12 0 0 1 9 2 12 12 0 0 1 9-2v16a12 12 0 0 0-9 0 12 12 0 0 0-9 0Z" />
    </Svg>
  );
}

export function NavIconMemory({ className }: IconProps) {
  return (
    <Svg className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3" />
    </Svg>
  );
}

export function NavIconSettings({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.82l.05.05-2.7 2.7-.05-.05a1.65 1.65 0 0 0-1.82-.3 1.65 1.65 0 0 0-1 1.5V21h-4v-.28a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.82.3l-.05.05-2.7-2.7.05-.05a1.65 1.65 0 0 0 .3-1.82 1.65 1.65 0 0 0-1.5-1H3v-4h.28a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.82l-.05-.05 2.7-2.7.05.05a1.65 1.65 0 0 0 1.82.3 1.65 1.65 0 0 0 1-1.5V3h4v.28a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.82-.3l.05-.05 2.7 2.7-.05.05a1.65 1.65 0 0 0-.3 1.82 1.65 1.65 0 0 0 1.5 1H21v4h-.28a1.65 1.65 0 0 0-1.32 1Z" />
    </Svg>
  );
}

export function NavIconHelp({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01" />
    </Svg>
  );
}

export function NavIconPlus({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function NavIconSparkles({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="M5 14l.8 2.5L8 17l-2.2.7L5 20l-.8-2.3L2 17l2.2-.5L5 14Z" />
      <path d="M19 15l.6 1.8L21 17l-1.4.4L19 19l-.6-1.6L17 17l1.4-.2L19 15Z" />
    </Svg>
  );
}

export function NavIconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function NavIconTheme({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
    </Svg>
  );
}

export function NavIconSidebarToggle({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18" />
    </Svg>
  );
}

export function NavIconBrand({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.3 20.4 7v10L12 21.7 3.6 17V7L12 2.3Z" />
      <path d="M12 2.3V12m0 0 8.4-5M12 12 3.6 7m8.4 5v9.7" />
    </svg>
  );
}

export function NavIconWorkspace({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m12 2 8 4.5V16l-8 4.5L4 16V6.5L12 2Zm0 9L4 6.5m8 4.5 8-4.5M12 11v9.5" />
    </Svg>
  );
}

export function NavIconSignOut({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m4 14 5-5-5-5m5 5H9" />
    </Svg>
  );
}

export function NavIconWorkspaceAccess({ className }: IconProps) {
  return NavIconWorkspace({ className });
}

export function NavIconSecurity({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 5 6v6c0 4.4 3 8.5 7 9 4-.5 7-4.6 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

const NAV_ICON_BY_ID: Record<string, (props: IconProps) => React.JSX.Element> =
  {
    home: NavIconHome,
    agents: NavIconAgents,
    workflows: NavIconWorkflows,
    activity: NavIconActivity,
    testing: NavIconTesting,
    models: NavIconModels,
    tools: NavIconTools,
    knowledge: NavIconKnowledge,
    memory: NavIconMemory,
    settings: NavIconSettings,
    help: NavIconHelp,
    "workspace-access": NavIconWorkspaceAccess,
    "security-activity": NavIconSecurity,
  };

export function ConsoleNavIcon({
  navId,
  className,
}: {
  readonly navId: string;
  readonly className?: string;
}) {
  const Icon = NAV_ICON_BY_ID[navId];
  if (Icon === undefined) {
    return null;
  }
  return <Icon className={className} />;
}
