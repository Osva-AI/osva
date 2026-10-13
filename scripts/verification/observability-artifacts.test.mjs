import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OBS_DIR = path.join(REPO_ROOT, "deploy", "observability");
const DASHBOARD_DIR = path.join(OBS_DIR, "grafana", "dashboards");

const PROMETHEUS_NAMES = [
  "osva_http_requests_total",
  "osva_http_request_duration_ms_bucket",
  "osva_queue_jobs",
  "osva_queue_stalled_total",
  "osva_queue_time_to_start_ms_bucket",
  "osva_recovery_lease_interrupted_total",
  "osva_recovery_transport_repaired_total",
  "osva_recovery_errors_total",
  "osva_security_events_total",
  "osva_runs_started_total",
  "osva_runs_completed_total",
  "osva_runs_failed_total",
  "osva_run_attempt_duration_ms_bucket",
  "osva_runtime_execute_duration_ms_bucket",
  "osva_tool_errors_total",
  "osva_model_calls_total",
  "osva_workflow_reconciliations_total",
  "osva_evaluation_reconciliations_total",
];

const FORBIDDEN_PROMQL = [
  "osva.http.requests",
  "runId",
  "runAttemptId",
  "workspaceId",
  "requestId",
  "traceId",
];

function extractExprs(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractExprs(entry, found);
    }
    return found;
  }
  if (value && typeof value === "object") {
    if (typeof value.expr === "string") {
      found.push(value.expr);
    }
    for (const nested of Object.values(value)) {
      extractExprs(nested, found);
    }
  }
  return found;
}

describe("observability artifacts", () => {
  it("keeps Grafana dashboard queries on Prometheus names", () => {
    const files = fs
      .readdirSync(DASHBOARD_DIR)
      .filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 4);
    const exprs = [];
    for (const file of files) {
      const dashboard = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_DIR, file), "utf8"),
      );
      assert.ok(dashboard.uid);
      assert.ok(dashboard.title);
      exprs.push(...extractExprs(dashboard));
    }
    assert.ok(exprs.length >= 16);
    const joined = exprs.join("\n");
    for (const name of PROMETHEUS_NAMES) {
      assert.match(joined, new RegExp(name.replaceAll(".", "\\.")));
    }
    for (const forbidden of FORBIDDEN_PROMQL) {
      assert.equal(joined.includes(forbidden), false, forbidden);
    }
  });

  it("uses rate or increase for counter alerts", () => {
    const alerts = fs.readFileSync(
      path.join(OBS_DIR, "prometheus", "alerts.yml"),
      "utf8",
    );
    assert.match(alerts, /OsvaApiHigh5xxRate/);
    assert.match(alerts, /rate\(osva_http_requests_total/);
    assert.match(alerts, /rate\(osva_queue_stalled_total/);
    assert.match(alerts, /rate\(osva_recovery_errors_total/);
    assert.match(alerts, /rate\(osva_security_events_total/);
    assert.doesNotMatch(alerts, /expr:\s*\n\s*osva_http_requests_total\s*[><]/);
    assert.match(alerts, /example threshold/i);
    assert.doesNotMatch(alerts, /^\s+- alert: OsvaCollectorDown/m);
  });

  it("does not publish collector receivers in the default collector config", () => {
    const collector = fs.readFileSync(
      path.join(OBS_DIR, "collector", "otel-collector.yaml"),
      "utf8",
    );
    assert.match(collector, /endpoint: 0\.0\.0\.0:4318/);
    assert.match(collector, /verbosity: basic/);
    assert.doesNotMatch(collector, /verbosity: detailed/);
    assert.doesNotMatch(collector, /Authorization:/);
  });
});
