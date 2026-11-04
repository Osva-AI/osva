import { LinkButton } from "../ui/button";

export type IntegrationsSectionNavActive = "tools" | "connectors";

export function IntegrationsSectionNav(props: {
  readonly active: IntegrationsSectionNavActive;
}) {
  return (
    <nav className="activity-v2-history-nav" aria-label="Integrations views">
      {props.active === "tools" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Tool registry
        </span>
      ) : (
        <LinkButton variant="secondary" to="/tools">
          Tool registry
        </LinkButton>
      )}
      {props.active === "connectors" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          MCP connectors
        </span>
      ) : (
        <LinkButton variant="secondary" to="/tools/connectors">
          MCP connectors
        </LinkButton>
      )}
    </nav>
  );
}
