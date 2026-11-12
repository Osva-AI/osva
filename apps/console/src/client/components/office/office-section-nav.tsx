import { LinkButton } from "../ui/button";

export type OfficeSectionNavActive =
  "mission-control" | "teams" | "workers" | "chat" | "inbox";

export function OfficeSectionNav(props: {
  readonly active: OfficeSectionNavActive;
}) {
  const items: Array<{
    readonly id: OfficeSectionNavActive;
    readonly label: string;
    readonly to: string;
  }> = [
    { id: "mission-control", label: "Mission Control", to: "/office" },
    { id: "chat", label: "Team Chat", to: "/office/chat" },
    { id: "inbox", label: "Inbox", to: "/office/inbox" },
    { id: "teams", label: "Teams", to: "/office/teams" },
    { id: "workers", label: "Workers", to: "/office/workers" },
  ];

  return (
    <nav className="activity-v2-history-nav" aria-label="Virtual Office views">
      {items.map((item) =>
        props.active === item.id ? (
          <span
            key={item.id}
            className="button button-secondary is-active-nav"
            aria-current="page"
          >
            {item.label}
          </span>
        ) : (
          <LinkButton key={item.id} variant="secondary" to={item.to}>
            {item.label}
          </LinkButton>
        ),
      )}
    </nav>
  );
}
