import { Link } from "react-router-dom";

import type { HomePageData } from "../../hooks/use-home-page-data";
import { refetchHomeEvidence } from "../../lib/home-refetch";
import { HomeV2AdvancedEntry } from "./home-v2-advanced-entry";

export function HomeV2Unavailable({
  reason,
  data,
}: {
  readonly reason: string;
  readonly data: HomePageData;
}) {
  const technicalMessages = [
    reason,
    ...data.partialErrors.filter((message) => message !== reason),
  ];

  return (
    <div className="home-v2 home-v2-unavailable">
      <section className="home-v2-outage" aria-labelledby="home-v2-error-title">
        <span className="home-v2-outage-icon" aria-hidden="true">
          !
        </span>
        <p className="home-v2-eyebrow">Workspace unavailable</p>
        <h1 id="home-v2-error-title" className="home-v2-outage-title">
          We couldn&apos;t load your workspace.
        </h1>
        <p className="home-v2-outage-lead muted">
          Your work may still be there. Try again, or open Agents or Workflows
          directly—we won&apos;t show misleading empty counts.
        </p>
        <div className="home-v2-hero-actions home-v2-outage-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              refetchHomeEvidence(data);
            }}
          >
            Try again
          </button>
          <Link className="button button-secondary" to="/agents">
            Open agents
          </Link>
          <Link className="button button-secondary" to="/workflows">
            Open workflows
          </Link>
        </div>
        {technicalMessages.length > 0 ? (
          <details className="home-v2-outage-details">
            <summary>Technical details</summary>
            <ul className="plain-list home-v2-outage-details-list">
              {technicalMessages.map((message) => (
                <li key={message} className="muted">
                  {message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <HomeV2AdvancedEntry
        preference={data.preference}
        onPreferenceChange={data.setPreference}
      />
    </div>
  );
}
