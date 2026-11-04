import { Link } from "react-router-dom";

export type TestingSection = "hub" | "playground" | "launch";

export function TestingSectionNav(props: {
  readonly active: TestingSection;
  readonly canExecute?: boolean;
}) {
  const { active, canExecute = true } = props;
  return (
    <nav aria-label="Testing views" className="activity-v2-history-nav">
      {active === "hub" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Overview
        </span>
      ) : (
        <Link className="button button-secondary" to="/testing">
          Overview
        </Link>
      )}
      {active === "playground" ? (
        <span
          className="button button-secondary is-active-nav"
          aria-current="page"
        >
          Playground
        </span>
      ) : (
        <Link className="button button-secondary" to="/testing/playground">
          Playground
        </Link>
      )}
      {canExecute ? (
        active === "launch" ? (
          <span
            className="button button-secondary is-active-nav"
            aria-current="page"
          >
            Launch evaluation
          </span>
        ) : (
          <Link className="button button-secondary" to="/testing/runs/new">
            Launch evaluation
          </Link>
        )
      ) : null}
    </nav>
  );
}
