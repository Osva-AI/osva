import { useEffect, useRef, useState } from "react";

import { getSelectedWorkspaceId } from "../lib/workspace-selection.js";
import {
  applyRunLiveSseMessage,
  buildRunLiveStreamUrl,
  parseSseBlock,
  runLiveStreamTerminalFromStatus,
  RUN_LIVE_STREAM_MAX_RECONNECT_ATTEMPTS,
  type RunLiveStreamAggregate,
  type RunLiveStreamPhase,
} from "../lib/run-live-stream-client.js";
import { isRunLive } from "../lib/statuses.js";

const EMPTY_AGGREGATE: RunLiveStreamAggregate = {
  partialText: "",
  textVisible: false,
  statusOnly: true,
  lastSequence: undefined,
  streamId: undefined,
  historyGap: false,
};

export interface UseRunLiveStreamResult {
  readonly phase: RunLiveStreamPhase;
  readonly partialText: string;
  readonly statusOnly: boolean;
  readonly textVisible: boolean;
  readonly historyGap: boolean;
  readonly reconnectAttempts: number;
  readonly statusAnnouncement: string;
}

export function useRunLiveStream(options: {
  readonly runId: string | undefined;
  readonly runStatus: string | undefined;
}): UseRunLiveStreamResult {
  const [phase, setPhase] = useState<RunLiveStreamPhase>("IDLE");
  const [aggregate, setAggregate] =
    useState<RunLiveStreamAggregate>(EMPTY_AGGREGATE);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const sessionRef = useRef(0);
  const reconnectRef = useRef(0);
  const mountedRef = useRef(true);

  const shouldSubscribe =
    options.runId !== undefined &&
    options.runStatus !== undefined &&
    isRunLive(options.runStatus);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldSubscribe || options.runId === undefined) {
      setPhase("IDLE");
      setAggregate(EMPTY_AGGREGATE);
      setReconnectAttempts(0);
      reconnectRef.current = 0;
      setStatusAnnouncement("");
      return;
    }

    const runId = options.runId;
    reconnectRef.current = 0;
    const workspaceId = getSelectedWorkspaceId();
    let cancelled = false;
    const session = sessionRef.current + 1;
    sessionRef.current = session;

    const abort = new AbortController();

    const connect = async (reconnecting: boolean): Promise<void> => {
      if (cancelled || session !== sessionRef.current) {
        return;
      }
      setPhase("CONNECTING");
      if (reconnecting) {
        setAggregate((current) => ({ ...current, historyGap: true }));
        setStatusAnnouncement(
          "Live connection interrupted. Reconnecting without replay.",
        );
      } else {
        setAggregate(EMPTY_AGGREGATE);
        setStatusAnnouncement("Connecting to live output.");
      }

      try {
        const headers: Record<string, string> = {
          accept: "text/event-stream",
        };
        if (workspaceId !== undefined) {
          headers["x-osva-workspace-id"] = workspaceId;
        }
        const response = await fetch(buildRunLiveStreamUrl(runId), {
          method: "GET",
          credentials: "include",
          headers,
          signal: abort.signal,
        });

        if (cancelled || session !== sessionRef.current) {
          return;
        }

        if (response.status === 503) {
          setPhase("UNAVAILABLE");
          setStatusAnnouncement(
            "Live output is not available for this deployment.",
          );
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setPhase("ERROR");
          setStatusAnnouncement("Not authorized to view live output.");
          return;
        }
        if (response.status === 404) {
          setPhase("ERROR");
          setStatusAnnouncement("Run not found in this workspace.");
          return;
        }
        if (!response.ok) {
          setPhase("ERROR");
          setStatusAnnouncement("Could not open live output stream.");
          return;
        }

        const reader = response.body?.getReader();
        if (reader === undefined) {
          setPhase("ERROR");
          setStatusAnnouncement("Live stream response was empty.");
          return;
        }

        setPhase("LIVE");
        setStatusAnnouncement("Live output connected.");
        reconnectRef.current = 0;
        setReconnectAttempts(0);

        const decoder = new TextDecoder();
        let buffer = "";
        let ready = false;

        while (!cancelled && session === sessionRef.current) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf("\n\n");
          while (split >= 0) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const message = parseSseBlock(block);
            if (message !== undefined) {
              if (message.event === "ready") {
                ready = true;
              }
              if (message.event === "run-live") {
                const terminal = runLiveStreamTerminalFromStatus(message.data);
                setAggregate((current) =>
                  applyRunLiveSseMessage(current, message, runId),
                );
                if (terminal === "ended") {
                  if (mountedRef.current) {
                    setPhase("ENDED");
                    setStatusAnnouncement(
                      "Model stream ended. Run status may still be updating.",
                    );
                  }
                  return;
                }
                if (terminal === "failed") {
                  if (mountedRef.current) {
                    setPhase("ENDED");
                    setStatusAnnouncement(
                      "Model stream failed. See run steps for details.",
                    );
                  }
                  return;
                }
              } else if (ready) {
                setAggregate((current) =>
                  applyRunLiveSseMessage(current, message, runId),
                );
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }

        if (cancelled || session !== sessionRef.current) {
          return;
        }

        if (
          options.runStatus !== undefined &&
          isRunLive(options.runStatus) &&
          reconnectRef.current < RUN_LIVE_STREAM_MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectRef.current += 1;
          setReconnectAttempts(reconnectRef.current);
          setPhase("DISCONNECTED");
          setStatusAnnouncement(
            "Live connection closed. Some output may be missing.",
          );
          await delay(400);
          await connect(true);
          return;
        }

        setPhase("DISCONNECTED");
        setStatusAnnouncement("Live connection closed.");
      } catch {
        if (
          abort.signal.aborted ||
          cancelled ||
          session !== sessionRef.current
        ) {
          return;
        }
        setPhase("ERROR");
        setStatusAnnouncement("Live output connection error.");
      }
    };

    void connect(false);

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [options.runId, options.runStatus, shouldSubscribe]);

  return {
    phase,
    partialText: aggregate.partialText,
    statusOnly: aggregate.statusOnly && !aggregate.textVisible,
    textVisible: aggregate.textVisible,
    historyGap: aggregate.historyGap,
    reconnectAttempts,
    statusAnnouncement,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
