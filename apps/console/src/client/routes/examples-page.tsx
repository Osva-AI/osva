import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { ExampleCatalogCard } from "../components/examples/example-catalog-card";
import { PageHeader } from "../components/ui/page-header";
import { EmptyState } from "../components/empty-state/empty-state";
import {
  EXAMPLE_CATEGORIES,
  EXAMPLE_COMPLEXITY_LEVELS,
  type ExampleCategory,
  type ExampleComplexity,
} from "../lib/osva-examples-catalog";
import { filterCatalogEntries } from "../lib/goal-discovery-matching";
import { OSVA_EXAMPLES_AUDITED_SHA } from "../lib/osva-examples-links";

function parseCategory(value: string | null): ExampleCategory | "all" {
  if (value === null || value.length === 0) {
    return "all";
  }
  if (EXAMPLE_CATEGORIES.some((c) => c.id === value)) {
    return value as ExampleCategory;
  }
  return "all";
}

function parseComplexity(value: string | null): ExampleComplexity | "all" {
  if (value === null || value.length === 0) {
    return "all";
  }
  if (EXAMPLE_COMPLEXITY_LEVELS.some((c) => c.id === value)) {
    return value as ExampleComplexity;
  }
  return "all";
}

export function ExamplesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const category = parseCategory(searchParams.get("category"));
  const complexity = parseComplexity(searchParams.get("complexity"));

  const entries = useMemo(
    () =>
      filterCatalogEntries({
        query,
        category,
        complexity,
      }),
    [query, category, complexity],
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

  return (
    <>
      <PageHeader
        title="Examples"
        subtitle="Read-only catalog of verified osva-examples documentation. Nothing here installs or deploys automatically."
        actions={
          <p className="muted example-provenance">
            Catalog pinned to{" "}
            <code className="mono">
              {OSVA_EXAMPLES_AUDITED_SHA.slice(0, 7)}
            </code>
          </p>
        }
      />

      <form
        className="examples-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          updateParams({
            q: String(data.get("q") ?? "").trim() || undefined,
          });
        }}
      >
        <label className="examples-filter-field">
          <span className="examples-filter-label">Search</span>
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Keywords, outcomes, or primitives"
            className="examples-filter-input"
          />
        </label>
        <label className="examples-filter-field">
          <span className="examples-filter-label">Category</span>
          <select
            className="examples-filter-select"
            value={category}
            onChange={(event) => {
              updateParams({
                category:
                  event.target.value === "all" ? undefined : event.target.value,
              });
            }}
          >
            <option value="all">All categories</option>
            {EXAMPLE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="examples-filter-field">
          <span className="examples-filter-label">Complexity</span>
          <select
            className="examples-filter-select"
            value={complexity}
            onChange={(event) => {
              updateParams({
                complexity:
                  event.target.value === "all" ? undefined : event.target.value,
              });
            }}
          >
            <option value="all">All levels</option>
            {EXAMPLE_COMPLEXITY_LEVELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button primary">
          Apply search
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="No examples match these filters."
          description="Clear filters or try broader keywords."
        />
      ) : (
        <div className="example-catalog-grid">
          {entries.map((entry) => (
            <ExampleCatalogCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}
