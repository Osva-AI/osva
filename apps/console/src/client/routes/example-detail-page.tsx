import { Navigate, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import {
  FixtureBadge,
  OsvaVersionBadge,
  VerificationBadges,
} from "../components/examples/example-evidence-badges";
import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { getExampleById } from "../lib/osva-examples-catalog";
import {
  buildExampleTreeUrl,
  isAllowedOsvaExamplesUrl,
  OSVA_EXAMPLES_AUDITED_SHA,
} from "../lib/osva-examples-links";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function ExampleDetailPage() {
  const { exampleId } = useParams<{ exampleId: string }>();
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (exampleId === undefined) {
    return <Navigate to="/examples" replace />;
  }

  const entry = getExampleById(exampleId);
  if (entry === undefined) {
    return (
      <>
        <PageHeader title="Example not found" />
        <EmptyState
          title="This example is not in the curated catalog."
          description="Return to the browse view for supported entries only."
        />
        <LinkButton variant="primary" to="/examples">
          Browse examples
        </LinkButton>
      </>
    );
  }

  const readmeAllowed = isAllowedOsvaExamplesUrl(entry.sourceReadmeUrl);
  const treeUrl = buildExampleTreeUrl(entry.sourcePath);
  const treeAllowed = isAllowedOsvaExamplesUrl(treeUrl);

  return (
    <>
      <PageHeader
        title={entry.title}
        subtitle={entry.description}
        actions={
          <LinkButton variant="secondary" to="/examples">
            Back to catalog
          </LinkButton>
        }
      />

      <div className="example-detail-stack">
        <SectionPanel title="At a glance">
          <div className="example-badge-row">
            <OsvaVersionBadge version={entry.osvaVersion} />
            <FixtureBadge fixtureBacked={entry.fixtureBacked} />
          </div>
          <VerificationBadges verification={entry.verification} />
          <p className="muted">
            Catalog entry <code className="mono">{entry.id}</code> · source{" "}
            <code className="mono">{entry.sourcePath}</code> · audited commit{" "}
            <code className="mono">
              {OSVA_EXAMPLES_AUDITED_SHA.slice(0, 12)}…
            </code>
          </p>
        </SectionPanel>

        <SectionPanel title="What it demonstrates">
          <ul className="example-detail-list">
            {entry.primitives.map((primitive) => (
              <li key={primitive}>{primitive}</li>
            ))}
          </ul>
        </SectionPanel>

        <SectionPanel title="Prerequisites">
          <ul className="example-detail-list">
            {entry.requirements.map((req) => (
              <li key={req}>{req}</li>
            ))}
          </ul>
        </SectionPanel>

        <SectionPanel title="Limitations">
          <ul className="example-detail-list">
            {entry.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </SectionPanel>

        <SectionPanel title="Source documentation">
          <p>
            Follow the verified README in the public osva-examples repository.
            The Console does not execute or install example code.
          </p>
          <div className="action-row">
            {readmeAllowed ? (
              <a
                className="button primary"
                href={entry.sourceReadmeUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open example README
              </a>
            ) : null}
            {treeAllowed ? (
              <a
                className="button button-secondary"
                href={treeUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Browse source tree
              </a>
            ) : null}
          </div>
        </SectionPanel>

        <SectionPanel title="Suggested next steps in this Console">
          <p className="muted">
            These links open existing Console routes. They do not import,
            configure, or run the example automatically.
          </p>
          <div className="action-row">
            {entry.consoleNextSteps.map((step) => {
              if (step.requiresWrite === true && !canWrite) {
                return null;
              }
              return (
                <LinkButton key={step.label} variant="secondary" to={step.to}>
                  {step.label}
                </LinkButton>
              );
            })}
            <LinkButton variant="secondary" to="/onboarding">
              Getting started
            </LinkButton>
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
