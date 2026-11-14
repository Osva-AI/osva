import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { ConnectorCatalogCard } from "../components/connectors/connector-catalog-card";
import { EmptyState } from "../components/empty-state/empty-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { LinkButton } from "../components/ui/button";
import {
  useConnectorCatalogWorkspaceIndex,
  workspaceStatusForEntry,
} from "../hooks/use-connector-catalog-workspace-index";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import {
  CONNECTOR_CAPABILITY_CATEGORIES,
  CONNECTOR_CATALOG_PROVENANCE,
  CONNECTOR_TRANSPORT_FILTERS,
  filterConnectorCatalogEntries,
  type ConnectorCapabilityCategory,
  type ConnectorCatalogTransport,
} from "../lib/osva-connectors-catalog";
import { OSVA_CONNECTORS_AUDITED_SHA } from "../lib/osva-connectors-links";

function parseCapability(
  value: string | null,
): ConnectorCapabilityCategory | "all" {
  if (value === null || value.length === 0) {
    return "all";
  }
  if (CONNECTOR_CAPABILITY_CATEGORIES.some((c) => c.id === value)) {
    return value as ConnectorCapabilityCategory | "all";
  }
  return "all";
}

function parseTransport(
  value: string | null,
): ConnectorCatalogTransport | "all" {
  if (value === null || value.length === 0) {
    return "all";
  }
  if (CONNECTOR_TRANSPORT_FILTERS.some((c) => c.id === value)) {
    return value as ConnectorCatalogTransport | "all";
  }
  return "all";
}

export function ConnectorCatalogPage() {
  const workspaceId = useWorkspaceQueryScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const capability = parseCapability(searchParams.get("capability"));
  const transport = parseTransport(searchParams.get("transport"));

  const workspaceIndex = useConnectorCatalogWorkspaceIndex();

  const entries = useMemo(
    () =>
      filterConnectorCatalogEntries({
        query,
        capability,
        transport,
      }),
    [query, capability, transport],
  );

  function updateParams(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value.length === 0) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    setSearchParams(next, { replace: true });
  }

  if (workspaceId === undefined) {
    return (
      <LoadingBlock label="Select a workspace to browse the connector catalog." />
    );
  }

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="connector-catalog-page"
    >
      <PageHeader
        title="Connector catalog"
        subtitle="Published @osva-ai MCP packages from osva-connectors. Browsing does not install packages or create workspace connectors."
        actions={
          <>
            <p className="muted example-provenance">
              Catalog pinned to{" "}
              <code className="mono">
                {OSVA_CONNECTORS_AUDITED_SHA.slice(0, 7)}
              </code>
              {" · "}
              schema v{CONNECTOR_CATALOG_PROVENANCE.schemaVersion}
            </p>
            <LinkButton variant="secondary" to="/tools/connectors">
              Workspace connectors
            </LinkButton>
          </>
        }
      />

      <IntegrationsSectionNav active="catalog" />

      <SectionPanel title="Security notice">
        <p className="muted">
          STDIO MCP requires operator approval on the control plane. Console
          does not accept arbitrary shell commands or auto-enable worker STDIO.
          Mutation tool classifications come from osva-connectors inventory and
          are not live provider verification for every package.
        </p>
      </SectionPanel>

      <form
        className="examples-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          updateParams({
            q: String(data.get("q") ?? "").trim() || undefined,
            capability:
              String(data.get("capability") ?? "all") === "all"
                ? undefined
                : String(data.get("capability")),
            transport:
              String(data.get("transport") ?? "all") === "all"
                ? undefined
                : String(data.get("transport")),
          });
        }}
      >
        <label className="examples-filter-field">
          <span className="examples-filter-label">Search</span>
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Provider, package, or connector id"
            className="examples-filter-input"
          />
        </label>
        <label className="examples-filter-field">
          <span className="examples-filter-label">Capabilities</span>
          <select
            name="capability"
            className="examples-filter-select"
            defaultValue={capability}
          >
            {CONNECTOR_CAPABILITY_CATEGORIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="examples-filter-field">
          <span className="examples-filter-label">Transport</span>
          <select
            name="transport"
            className="examples-filter-select"
            defaultValue={transport}
          >
            {CONNECTOR_TRANSPORT_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button-primary">
          Apply filters
        </button>
      </form>

      {workspaceIndex.isLoading ? (
        <LoadingBlock label="Loading workspace integration hints…" />
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="No connectors match your filters"
          description="Try clearing search terms or choosing a broader capability filter."
        />
      ) : (
        <div
          className="example-catalog-grid"
          role="list"
          aria-label="Published connector catalog"
        >
          {entries.map((entry) => (
            <ConnectorCatalogCard
              key={entry.connectorId}
              entry={entry}
              workspaceStatus={workspaceStatusForEntry(
                entry,
                workspaceIndex.statusByConnectorId,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
