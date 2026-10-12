import { useCallback, useEffect, useRef, useState } from "react";

import {
  ArtifactPreviewCancelledError,
  classifyArtifactPreview,
  fetchArtifactPreviewText,
} from "../lib/artifact-preview";
import type { ArtifactResource } from "./use-runs";

export type ArtifactPreviewStatus =
  "closed" | "blocked" | "loading" | "ready" | "error";

export interface ArtifactPreviewState {
  readonly selectedId: string | undefined;
  readonly status: ArtifactPreviewStatus;
  readonly text: string | undefined;
  readonly error: unknown;
  open(artifact: ArtifactResource): void;
  close(): void;
}

export function useArtifactPreview(): ArtifactPreviewState {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [status, setStatus] = useState<ArtifactPreviewStatus>("closed");
  const [text, setText] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const close = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    requestRef.current += 1;
    setSelectedId(undefined);
    setStatus("closed");
    setText(undefined);
    setError(undefined);
  }, []);

  const open = useCallback((artifact: ArtifactResource): void => {
    abortRef.current?.abort();
    const capability = classifyArtifactPreview(artifact);
    requestRef.current += 1;
    const requestId = requestRef.current;
    setSelectedId(artifact.id);
    setText(undefined);
    setError(undefined);

    if (capability === "unsupported" || capability === "too-large") {
      abortRef.current = undefined;
      setStatus("blocked");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");

    void fetchArtifactPreviewText(artifact.id, { signal: controller.signal })
      .then((content) => {
        if (requestId !== requestRef.current) {
          return;
        }
        setText(content);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (
          requestId !== requestRef.current ||
          controller.signal.aborted ||
          caught instanceof ArtifactPreviewCancelledError
        ) {
          return;
        }
        setError(caught);
        setStatus("error");
      });
  }, []);

  return { selectedId, status, text, error, open, close };
}
