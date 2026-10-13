# OSVA observability examples

Optional Collector, Prometheus, Grafana dashboards, and alert rules for
Community Edition. Nothing here is required to run the execution engine.

Dashboards are importable examples. They are not a hosted OSVA service.

## Enable Compose observability

Default Compose (`deploy/compose/compose.yml`) does **not** set
`OTEL_EXPORTER_OTLP_ENDPOINT` and does not start a collector.

```bash
cd deploy/compose
docker compose -f compose.yml -f compose.observability.yml up -d
```

That overlay is the opt-in mechanism. Compose profiles cannot make application
environment variables conditional, so `--profile observability` alone is not
used.

Grafana (example UI) binds `127.0.0.1:3001`. Collector OTLP (`4318`) and the
Prometheus scrape port (`8889`) are internal only.

## Helm

The application chart does not deploy a collector. See
`helm/external-collector-values.example.yaml`.

```bash
helm upgrade --install osva ./deploy/helm/osva \
  --set telemetry.enabled=true \
  --set telemetry.otlpEndpoint=http://otel-collector.observability.svc:4318
```

Put `OTEL_EXPORTER_OTLP_HEADERS` in `existingSecret` or `secretEnv`.

## Import Grafana dashboards

1. Add a Prometheus datasource with uid `prometheus` (Compose provisioning
   does this automatically).
2. Import JSON from `grafana/dashboards/`.
3. Queries use Prometheus names from [`METRICS.md`](METRICS.md), not dotted
   OTEL instrument names.

## Install alert rules

Load `prometheus/alerts.yml` with your Prometheus `rule_files`. Thresholds
are examples. Leave `OsvaCollectorDown` commented unless you scrape
`job=osva-otel-collector`.

## Collector outage

OSVA processes fail open. A down collector does not fail `/ready` or execution.
Telemetry is delayed or dropped until export succeeds.

## Privacy

Application instrumentation emits metadata only. Collector-side redaction
cannot repair secrets already exported. Do not set Collector `debug.verbosity`
to `detailed`.
