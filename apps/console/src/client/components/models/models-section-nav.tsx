import { LinkButton } from "../ui/button";

export type ModelsSectionNavActive = "profiles" | "connections";

export function ModelsSectionNav(props: {
  readonly active: ModelsSectionNavActive;
}) {
  return (
    <nav className="activity-v2-history-nav" aria-label="Models views">
      {props.active === "profiles" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Model profiles
        </span>
      ) : (
        <LinkButton variant="secondary" to="/models">
          Model profiles
        </LinkButton>
      )}
      {props.active === "connections" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Provider connections
        </span>
      ) : (
        <LinkButton variant="secondary" to="/models/connections">
          Provider connections
        </LinkButton>
      )}
    </nav>
  );
}
