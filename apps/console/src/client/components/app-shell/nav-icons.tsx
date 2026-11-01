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

export function NavIconSpark({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 9.5 10.5 2 13l7.5 2.5L12 23l2.5-7.5L22 13l-7.5-2.5z" />
    </Svg>
  );
}

export function NavIconAgents({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </Svg>
  );
}

export function NavIconWorkflows({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="6" height="6" rx="1.25" />
      <rect x="15" y="5" width="6" height="6" rx="1.25" />
      <rect x="9" y="13" width="6" height="6" rx="1.25" />
      <path d="M9 8h6M12 11v2" />
    </Svg>
  );
}

export function NavIconModels({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="M12 11 4 7M12 11l8-4M12 11v10" />
    </Svg>
  );
}

export function NavIconTools({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4z" />
    </Svg>
  );
}

export function NavIconKnowledge({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" />
      <path d="M7 4v13a2 2 0 0 0 2 2h9" />
    </Svg>
  );
}

export function NavIconMemory({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </Svg>
  );
}

export function NavIconRuns({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 5v14l11-7z" />
    </Svg>
  );
}

export function NavIconWorkflowRuns({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12h3l2-7 4 14 2-7h3" />
    </Svg>
  );
}

export function NavIconTesting({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 3h6v4H9z" />
      <path d="M10 7h4v14h-4z" />
      <path d="M6 21h12" />
    </Svg>
  );
}

export function NavIconWorkspaceAccess({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6" />
      <path d="M16 11h5M18.5 8.5v5" />
    </Svg>
  );
}

export function NavIconSecurity({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3 5 6v6c0 4.4 3 8.5 7 9 4-.5 7-4.6 7-9V6z" />
    </Svg>
  );
}

const NAV_ICON_BY_ID: Record<string, (props: IconProps) => React.JSX.Element> =
  {
    home: NavIconHome,
    "getting-started": NavIconSpark,
    agents: NavIconAgents,
    workflows: NavIconWorkflows,
    models: NavIconModels,
    tools: NavIconTools,
    knowledge: NavIconKnowledge,
    memory: NavIconMemory,
    runs: NavIconRuns,
    "workflow-runs": NavIconWorkflowRuns,
    "testing-studio": NavIconTesting,
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
