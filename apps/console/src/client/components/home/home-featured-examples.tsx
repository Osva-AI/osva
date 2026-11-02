import { Link } from "react-router-dom";

import { getFeaturedExamples } from "../../lib/osva-examples-catalog";
import { LinkButton } from "../ui/button";
import { SectionPanel } from "../ui/section-panel";
import {
  FixtureBadge,
  OsvaVersionBadge,
} from "../examples/example-evidence-badges";

export function HomeFeaturedExamples() {
  const featured = getFeaturedExamples();

  return (
    <SectionPanel
      title="Featured verified examples"
      description="Curated entries from the public osva-examples repository—documentation and source paths audited at a fixed commit."
    >
      <ul className="home-featured-list">
        {featured.map((entry) => (
          <li key={entry.id} className="home-featured-item">
            <div>
              <Link to={`/examples/${entry.id}`} className="home-featured-link">
                <strong>{entry.title}</strong>
              </Link>
              <p className="muted home-featured-summary">{entry.description}</p>
              <div className="example-badge-row">
                <OsvaVersionBadge version={entry.osvaVersion} />
                <FixtureBadge fixtureBacked={entry.fixtureBacked} />
              </div>
            </div>
            <LinkButton variant="secondary" to={`/examples/${entry.id}`}>
              Details
            </LinkButton>
          </li>
        ))}
      </ul>
      <div className="action-row">
        <LinkButton variant="primary" to="/examples">
          Browse all examples
        </LinkButton>
      </div>
    </SectionPanel>
  );
}
