import { LinkButton } from "../ui/button";

export type OfficeSectionNavActive = "mission-control" | "teams" | "workers";

export function OfficeSectionNav(props: {
  readonly active: OfficeSectionNavActive;
}) {
  return (
    <nav className="activity-v2-history-nav" aria-label="Virtual Office views">
      {props.active === "mission-control" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Mission Control
        </span>
      ) : (
        <LinkButton variant="secondary" to="/office">
          Mission Control
        </LinkButton>
      )}
      {props.active === "teams" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Teams
        </span>
      ) : (
        <LinkButton variant="secondary" to="/office/teams">
          Teams
        </LinkButton>
      )}
      {props.active === "workers" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Workers
        </span>
      ) : (
        <LinkButton variant="secondary" to="/office/workers">
          Workers
        </LinkButton>
      )}
    </nav>
  );
}
