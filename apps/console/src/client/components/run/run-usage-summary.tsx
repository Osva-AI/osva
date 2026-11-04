import type { RunAttemptUsageResource } from "../../hooks/use-runs";
import { formatUsdMicros } from "../../lib/formatting";
import { EmptyState } from "../empty-state/empty-state";

interface RunUsageSummaryProps {
  readonly usage: RunAttemptUsageResource | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

function UsageMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function RunUsageSummary({
  usage,
  isLoading,
  isError,
}: RunUsageSummaryProps) {
  if (isLoading) {
    return <p className="muted">Loading usage…</p>;
  }

  if (isError || usage === undefined) {
    return <EmptyState title="No usage available for this attempt." />;
  }

  const showUnpricedWarning = usage.unpricedModelCalls > 0;
  const estimatedCost = formatUsdMicros(usage.estimatedCostUsdMicros);

  const secondaryMetrics = (
    <>
      <UsageMetric label="Input tokens" value={usage.inputTokens} />
      <UsageMetric label="Output tokens" value={usage.outputTokens} />
      <UsageMetric
        label="Cached input tokens"
        value={usage.cachedInputTokens}
      />
      <UsageMetric label="Priced model calls" value={usage.pricedModelCalls} />
      <UsageMetric
        label="Unpriced model calls"
        value={usage.unpricedModelCalls}
      />
    </>
  );

  return (
    <div className="run-usage-summary" data-testid="run-usage-summary">
      <dl
        className="run-usage-grid run-usage-primary meta-grid"
        data-testid="run-usage-primary"
      >
        <UsageMetric label="Model calls" value={usage.modelCalls} />
        <UsageMetric label="Tool calls" value={usage.toolCalls} />
        <UsageMetric label="Total tokens" value={usage.totalTokens} />
        <UsageMetric label="Estimated cost" value={estimatedCost} />
      </dl>
      <dl
        className="run-usage-grid run-usage-secondary-desktop meta-grid"
        data-testid="run-usage-secondary"
      >
        {secondaryMetrics}
      </dl>
      <details className="run-usage-secondary-mobile">
        <summary>More usage details</summary>
        <dl className="run-usage-grid meta-grid">{secondaryMetrics}</dl>
      </details>
      {showUnpricedWarning ? (
        <p className="run-usage-unpriced muted" role="status">
          {usage.unpricedModelCalls} model call
          {usage.unpricedModelCalls === 1 ? "" : "s"} had no persisted price.
          Estimated cost excludes unpriced calls and is not zero.
        </p>
      ) : null}
    </div>
  );
}
