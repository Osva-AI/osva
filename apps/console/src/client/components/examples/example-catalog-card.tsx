import { Link } from "react-router-dom";

import type { OsvaExampleCatalogEntry } from "../../lib/osva-examples-catalog";
import { EXAMPLE_CATEGORIES } from "../../lib/osva-examples-catalog";
import {
  FixtureBadge,
  OsvaVersionBadge,
  VerificationBadges,
} from "./example-evidence-badges";

function categoryLabel(category: OsvaExampleCatalogEntry["category"]): string {
  return EXAMPLE_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export function ExampleCatalogCard({
  entry,
  matchReasons,
}: {
  readonly entry: OsvaExampleCatalogEntry;
  readonly matchReasons?: readonly string[];
}) {
  return (
    <article className="example-catalog-card">
      <header className="example-catalog-card-header">
        <div>
          <p className="example-catalog-card-kicker">
            {categoryLabel(entry.category)} · {entry.complexity}
          </p>
          <h3 className="example-catalog-card-title">
            <Link to={`/examples/${entry.id}`}>{entry.title}</Link>
          </h3>
        </div>
      </header>
      <p className="example-catalog-card-description">{entry.description}</p>
      <div className="example-badge-row">
        <OsvaVersionBadge version={entry.osvaVersion} />
        <FixtureBadge fixtureBacked={entry.fixtureBacked} />
      </div>
      <VerificationBadges verification={entry.verification} />
      {matchReasons !== undefined && matchReasons.length > 0 ? (
        <p className="example-match-reason">
          <strong>Why this matches:</strong> {matchReasons.join("; ")}
        </p>
      ) : null}
      <div className="action-row example-catalog-card-actions">
        <Link className="button primary" to={`/examples/${entry.id}`}>
          View details
        </Link>
        <a
          className="button button-secondary"
          href={entry.sourceReadmeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source README
        </a>
      </div>
    </article>
  );
}
