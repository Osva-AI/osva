import { type FormEvent, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getExampleById } from "../../lib/osva-examples-catalog";
import {
  matchGoalToExamples,
  SUGGESTED_GOAL_PROMPTS,
} from "../../lib/goal-discovery-matching";
import { Button, LinkButton } from "../ui/button";
import { ExampleCatalogCard } from "../examples/example-catalog-card";
import { InlineMessage } from "../ui/inline-message";

export function HomeGoalDiscovery({
  canWrite,
}: {
  readonly canWrite: boolean;
}) {
  const inputId = useId();
  const [goal, setGoal] = useState("");
  const [submittedGoal, setSubmittedGoal] = useState<string | null>(null);

  const matchResult = useMemo(() => {
    if (submittedGoal === null || submittedGoal.trim().length === 0) {
      return null;
    }
    return matchGoalToExamples(submittedGoal);
  }, [submittedGoal]);

  function submitGoal(nextGoal: string) {
    const trimmed = nextGoal.trim();
    setGoal(trimmed);
    setSubmittedGoal(trimmed);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitGoal(goal);
  }

  return (
    <div className="home-goal-discovery">
      <form className="home-goal-form" onSubmit={onSubmit}>
        <label className="home-goal-label" htmlFor={inputId}>
          Describe your goal
        </label>
        <div className="home-goal-input-row">
          <input
            id={inputId}
            className="home-goal-input"
            type="search"
            name="goal"
            autoComplete="off"
            placeholder="e.g. automate customer support with approvals"
            value={goal}
            onChange={(event) => {
              setGoal(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitGoal(goal);
              }
            }}
          />
          <Button type="submit" variant="primary">
            Find matching examples
          </Button>
        </div>
        <p className="muted home-goal-hint">
          Local keyword matching against verified osva-examples documentation—no
          generation and no network calls.
        </p>
      </form>

      <div
        className="home-goal-suggestions"
        role="group"
        aria-label="Suggested goals"
      >
        {SUGGESTED_GOAL_PROMPTS.map((prompt) => (
          <button
            key={prompt.goal}
            type="button"
            className="home-goal-chip"
            onClick={() => {
              submitGoal(prompt.goal);
            }}
          >
            {prompt.label}
          </button>
        ))}
      </div>

      {matchResult !== null ? (
        <section
          className="home-goal-results"
          aria-live="polite"
          aria-labelledby="home-goal-results-title"
        >
          <h3 className="home-goal-results-title" id="home-goal-results-title">
            Recommended examples
          </h3>
          {matchResult.matches.length === 0 ? (
            <InlineMessage tone="info" title="No keyword overlap">
              We could not map that goal to a curated example. Try refining your
              words, <Link to="/examples">browse all examples</Link>, or open{" "}
              {canWrite ? (
                <>
                  <Link to="/agents/new">Agent Studio</Link> or{" "}
                  <Link to="/workflows/new">Workflow Builder</Link>
                </>
              ) : (
                <>
                  <Link to="/agents">agents</Link> or{" "}
                  <Link to="/workflows">workflows</Link>
                </>
              )}{" "}
              to build from scratch.
            </InlineMessage>
          ) : null}

          {matchResult.matches.length > 0 && !matchResult.hasReliableMatch ? (
            <InlineMessage tone="warning" title="Weak match">
              Matches below are tentative—review prerequisites before adopting
              an example. <Link to="/examples">Browse all examples</Link> for
              full context.
            </InlineMessage>
          ) : null}

          <div className="example-catalog-grid">
            {matchResult.matches.map((match) => {
              const entry = getExampleById(match.exampleId);
              if (entry === undefined) {
                return null;
              }
              return (
                <ExampleCatalogCard
                  key={entry.id}
                  entry={entry}
                  matchReasons={match.reasons}
                />
              );
            })}
          </div>

          <div className="action-row home-goal-results-actions">
            <LinkButton variant="secondary" to="/examples">
              Browse all examples
            </LinkButton>
            {canWrite ? (
              <>
                <LinkButton variant="secondary" to="/agents/new">
                  Agent Studio
                </LinkButton>
                <LinkButton variant="secondary" to="/workflows/new">
                  Workflow Builder
                </LinkButton>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
