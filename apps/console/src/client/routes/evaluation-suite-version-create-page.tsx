import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { EvaluationSuiteBuilderWorkspace } from "../components/evaluation/evaluation-suite-builder-workspace";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useEvaluationSuiteQuery,
  useEvaluationSuiteVersionQuery,
  useEvaluationSuiteVersionsQuery,
} from "../hooks/use-evaluations";
import {
  createDraftFromPublishedVersion,
  createEmptyVersionDraft,
  type EvaluationSuiteVersionDraft,
} from "../lib/evaluation-suite-builder-draft";
import { ConsoleApiError } from "../lib/console-api";

export function EvaluationSuiteVersionCreatePage() {
  const { evaluationSuiteId } = useParams<{ evaluationSuiteId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const suiteQuery = useEvaluationSuiteQuery(evaluationSuiteId);
  const versionsQuery = useEvaluationSuiteVersionsQuery(evaluationSuiteId);

  const sourceVersionIdParam = searchParams.get("from") ?? undefined;
  const sortedVersions = useMemo(() => {
    return [...(versionsQuery.data?.items ?? [])].sort(
      (left, right) => right.version - left.version,
    );
  }, [versionsQuery.data?.items]);

  const defaultSourceVersionId = sourceVersionIdParam ?? sortedVersions[0]?.id;
  const sourceVersionQuery = useEvaluationSuiteVersionQuery(
    evaluationSuiteId,
    defaultSourceVersionId,
  );

  const [draft, setDraft] = useState<EvaluationSuiteVersionDraft | undefined>();
  const [initializedFromVersionId, setInitializedFromVersionId] = useState<
    string | undefined
  >();

  useEffect(() => {
    if (
      authQuery.data === undefined ||
      evaluationSuiteId === undefined ||
      suiteQuery.data === undefined
    ) {
      return;
    }

    if (defaultSourceVersionId === undefined) {
      if (initializedFromVersionId === "__empty__") {
        return;
      }
      setDraft(
        createEmptyVersionDraft({
          workspaceId: authQuery.data.workspaceId,
          evaluationSuiteId,
        }),
      );
      setInitializedFromVersionId("__empty__");
      return;
    }

    if (sourceVersionQuery.data === undefined) {
      return;
    }

    const sourceId = sourceVersionQuery.data.id;
    if (initializedFromVersionId === sourceId) {
      return;
    }

    setDraft(
      createDraftFromPublishedVersion({
        workspaceId: authQuery.data.workspaceId,
        evaluationSuiteId,
        version: sourceVersionQuery.data,
      }),
    );
    setInitializedFromVersionId(sourceId);
  }, [
    authQuery.data,
    defaultSourceVersionId,
    evaluationSuiteId,
    initializedFromVersionId,
    sourceVersionQuery.data,
    suiteQuery.data,
  ]);

  if (evaluationSuiteId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing evaluationSuiteId.")}
      />
    );
  }

  const notFound =
    suiteQuery.isError &&
    suiteQuery.error instanceof ConsoleApiError &&
    suiteQuery.error.status === 404;

  if (suiteQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingBlock label="Loading evaluation suite…" />;
  }

  if (notFound) {
    return (
      <EmptyState
        title="Evaluation suite not found."
        description="This suite is not visible in your workspace."
      />
    );
  }

  if (
    draft === undefined ||
    (defaultSourceVersionId !== undefined && sourceVersionQuery.isLoading)
  ) {
    return <LoadingBlock label="Preparing draft…" />;
  }

  return (
    <EvaluationSuiteBuilderWorkspace
      title="Draft suite version"
      subtitle={
        sourceVersionQuery.data !== undefined
          ? `Editing a new version from v${sourceVersionQuery.data.version}. Published versions stay unchanged until you publish.`
          : "Add JSON test cases and publish an immutable suite version."
      }
      initialDraft={draft}
      backLink={{
        to: `/testing/suites/${evaluationSuiteId}`,
        label: "Back to suite",
      }}
      onPublished={({
        evaluationSuiteId: suiteId,
        evaluationSuiteVersionId,
      }) => {
        navigate(
          `/testing/suites/${suiteId}/versions/${evaluationSuiteVersionId}`,
          { replace: true },
        );
      }}
    />
  );
}
