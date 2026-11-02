import type {
  ExampleVerificationEvidence,
  OsvaVersionTarget,
} from "../../lib/osva-examples-catalog";

export function OsvaVersionBadge({
  version,
}: {
  readonly version: OsvaVersionTarget;
}) {
  return (
    <span className="example-badge example-badge-version">OSVA {version}</span>
  );
}

export function FixtureBadge({
  fixtureBacked,
}: {
  readonly fixtureBacked: boolean;
}) {
  if (!fixtureBacked) {
    return (
      <span className="example-badge example-badge-live-path">
        Live-oriented demo
      </span>
    );
  }
  return (
    <span className="example-badge example-badge-fixture">
      Fixture-backed paths
    </span>
  );
}

export function VerificationBadges({
  verification,
}: {
  readonly verification: ExampleVerificationEvidence;
}) {
  return (
    <div className="example-badge-row" aria-label="Verification evidence">
      <span className="example-badge example-badge-verified">
        Source documented
      </span>
      {verification.offlineCiSmoke ? (
        <span className="example-badge example-badge-verified">
          Offline CI / smoke
        </span>
      ) : null}
      {verification.liveIntegrationVerified ? (
        <span className="example-badge example-badge-verified">
          Live integration verified
        </span>
      ) : (
        <span className="example-badge example-badge-muted">
          Live run is manual
        </span>
      )}
    </div>
  );
}
