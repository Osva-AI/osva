import { SectionPanel } from "../ui/section-panel";
import {
  formatUsdMicrosForDisplay,
  INFERENCE_BUDGET_LIABILITY_DISCLAIMER,
} from "../../lib/inference-budget-presentation";
import type { InferenceBudgetPeriodUsageResource } from "../../hooks/use-inference-budget";

export function PeriodLedgerPanel(props: {
  readonly title: string;
  readonly usage: InferenceBudgetPeriodUsageResource | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly emptyLabel: string;
}) {
  const { usage, isLoading, error, emptyLabel } = props;

  if (isLoading) {
    return (
      <SectionPanel title={props.title}>
        <p className="muted">Loading period data…</p>
      </SectionPanel>
    );
  }

  if (error !== null) {
    return (
      <SectionPanel title={props.title}>
        <p className="form-error" role="alert">
          {error.message}
        </p>
      </SectionPanel>
    );
  }

  if (usage === undefined) {
    return null;
  }

  const ledger = usage.ledger;

  return (
    <SectionPanel
      title={props.title}
      description={`UTC period ${usage.period.periodKey} (${usage.period.periodStartUtc} → ${usage.period.periodEndExclusiveUtc})`}
    >
      <p className="panel-description muted">
        {INFERENCE_BUDGET_LIABILITY_DISCLAIMER}
      </p>
      {ledger === null ? (
        <p className="muted" data-testid="inference-budget-period-empty">
          {emptyLabel}
        </p>
      ) : (
        <dl className="meta-list inference-budget-ledger-dl">
          <div>
            <dt>Configured estimated budget</dt>
            <dd>{formatUsdMicrosForDisplay(ledger.limitUsdMicros)}</dd>
          </div>
          <div>
            <dt>Estimated committed liability</dt>
            <dd>
              {formatUsdMicrosForDisplay(ledger.committedLiabilityUsdMicros)}
            </dd>
          </div>
          <div>
            <dt>Held reservations</dt>
            <dd>
              {formatUsdMicrosForDisplay(ledger.heldReservationsUsdMicros)}
            </dd>
          </div>
          <div>
            <dt>Unresolved uncertain liability</dt>
            <dd data-testid="inference-budget-uncertain-liability">
              {formatUsdMicrosForDisplay(
                ledger.unresolvedUncertainLiabilityUsdMicros,
              )}
            </dd>
          </div>
          <div>
            <dt>Recorded overage</dt>
            <dd data-testid="inference-budget-overage">
              {formatUsdMicrosForDisplay(ledger.overageUsdMicros)}
            </dd>
          </div>
          <div>
            <dt>Available reservation capacity</dt>
            <dd>
              {usage.availableReservationCapacityUsdMicros === null
                ? "—"
                : formatUsdMicrosForDisplay(
                    usage.availableReservationCapacityUsdMicros,
                  )}
            </dd>
          </div>
          <div>
            <dt>Policy version on ledger</dt>
            <dd className="mono">{ledger.budgetPolicyVersionId}</dd>
          </div>
        </dl>
      )}
    </SectionPanel>
  );
}
