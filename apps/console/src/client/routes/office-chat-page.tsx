import type {
  OfficeMessageMentionV1,
  OfficeWorkerId,
  UserId,
} from "@osva-ai/contracts";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  createMessageIdempotencyKey,
  useCreateOfficeThreadMutation,
  useOfficeThreadMessagesInfiniteQuery,
  useOfficeThreadQuery,
  useOfficeThreadsQuery,
  usePostOfficeMessageMutation,
  useUpdateInboxReadStateMutation,
  useWorkspaceMembershipDirectoryQuery,
  type OfficeMessageResource,
} from "../hooks/use-office-collaboration";
import { useOfficeWorkersQuery } from "../hooks/use-office";
import { ConsoleApiError } from "../lib/console-api";
import { flattenOfficeThreadMessages } from "../lib/office-chat-messages";
import { formatTimestamp } from "../lib/formatting";
import { roleCanAuthorOfficeChat } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

type PendingMention =
  | { readonly kind: "HUMAN"; readonly userId: string; readonly label: string }
  | {
      readonly kind: "OFFICE_WORKER";
      readonly officeWorkerId: string;
      readonly label: string;
    };

function messageAuthorLabel(
  message: OfficeMessageResource,
  currentUserId: string | undefined,
  membershipLabels: ReadonlyMap<string, string>,
): string {
  if (message.authorUserId === undefined) {
    return "Unknown";
  }
  if (message.authorUserId === currentUserId) {
    return "You";
  }
  return membershipLabels.get(message.authorUserId) ?? message.authorUserId;
}

export function OfficeChatPage() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const workspaceId = useWorkspaceQueryScope();
  const prevWorkspaceRef = useRef<string | undefined>(workspaceId);
  const authQuery = useAuthContextQuery();
  const threadsQuery = useOfficeThreadsQuery();
  const threadQuery = useOfficeThreadQuery(threadId);
  const messagesQuery = useOfficeThreadMessagesInfiniteQuery(threadId ?? "");
  const workersQuery = useOfficeWorkersQuery();
  const membershipsQuery = useWorkspaceMembershipDirectoryQuery();
  const createThread = useCreateOfficeThreadMutation();
  const postMessage = usePostOfficeMessageMutation();
  const markRead = useUpdateInboxReadStateMutation();

  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [replyTo, setReplyTo] = useState<OfficeMessageResource | undefined>();
  const [pendingMentions, setPendingMentions] = useState<
    readonly PendingMention[]
  >([]);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const pendingIdempotencyKey = useRef<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedSequenceRef = useRef(0);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanAuthorOfficeChat(authQuery.data.role);

  const membershipLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of membershipsQuery.data ?? []) {
      map.set(row.userId, row.userId);
    }
    return map;
  }, [membershipsQuery.data]);

  const messages = useMemo(
    () => flattenOfficeThreadMessages(messagesQuery.data?.pages),
    [messagesQuery.data?.pages],
  );

  const visibleThreads = useMemo(() => {
    const items = threadsQuery.data?.items ?? [];
    if (workspaceId === undefined) {
      return items;
    }
    return items.filter((thread) => thread.workspaceId === workspaceId);
  }, [threadsQuery.data?.items, workspaceId]);

  const threadTitle =
    threadQuery.data?.title ??
    visibleThreads.find((t) => t.id === threadId)?.title;

  useEffect(() => {
    if (
      prevWorkspaceRef.current !== undefined &&
      workspaceId !== undefined &&
      workspaceId !== prevWorkspaceRef.current
    ) {
      pendingIdempotencyKey.current = undefined;
      if (threadId !== undefined) {
        void navigate("/office/chat", { replace: true });
      }
    }
    prevWorkspaceRef.current = workspaceId;
  }, [workspaceId, threadId, navigate]);

  useEffect(() => {
    lastMarkedSequenceRef.current = 0;
  }, [threadId, workspaceId]);

  useEffect(() => {
    if (threadId === undefined || messages.length === 0) {
      return;
    }
    const latestSequence = messages[messages.length - 1]?.sequence;
    if (latestSequence === undefined) {
      return;
    }
    const threadCap = threadQuery.data?.latestMessageSequence;
    const lastReadSequence =
      threadCap === undefined
        ? latestSequence
        : Math.min(latestSequence, threadCap);
    if (lastReadSequence <= lastMarkedSequenceRef.current) {
      return;
    }
    lastMarkedSequenceRef.current = lastReadSequence;
    markRead.mutate({ threadId, lastReadSequence });
  }, [threadId, messages, markRead, threadQuery.data?.latestMessageSequence]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, threadId]);

  async function handleCreateThread(event: FormEvent) {
    event.preventDefault();
    const title = newThreadTitle.trim();
    if (title.length === 0) {
      return;
    }
    setSubmitError(undefined);
    try {
      const created = await createThread.mutateAsync({ title });
      setNewThreadTitle("");
      void navigate(`/office/chat/${created.id}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create.",
      );
    }
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (threadId === undefined) {
      return;
    }
    const body = composerBody.trim();
    if (body.length === 0) {
      return;
    }
    if (pendingIdempotencyKey.current === undefined) {
      pendingIdempotencyKey.current = createMessageIdempotencyKey();
    }
    const mentions: OfficeMessageMentionV1[] = pendingMentions.map((mention) =>
      mention.kind === "HUMAN"
        ? { kind: "HUMAN", userId: mention.userId as UserId }
        : {
            kind: "OFFICE_WORKER",
            officeWorkerId: mention.officeWorkerId as OfficeWorkerId,
          },
    );
    setSubmitError(undefined);
    try {
      await postMessage.mutateAsync({
        threadId,
        body,
        parentMessageId: replyTo?.id,
        mentions,
        idempotencyKey: pendingIdempotencyKey.current,
      });
      pendingIdempotencyKey.current = undefined;
      setComposerBody("");
      setReplyTo(undefined);
      setPendingMentions([]);
    } catch (error) {
      if (error instanceof ConsoleApiError && error.status === 403) {
        setSubmitError("You do not have permission to post in this workspace.");
        return;
      }
      setSubmitError(error instanceof Error ? error.message : "Send failed.");
    }
  }

  function addMention(mention: PendingMention) {
    setPendingMentions((current) => {
      if (
        current.some(
          (item) =>
            (item.kind === "HUMAN" &&
              mention.kind === "HUMAN" &&
              item.userId === mention.userId) ||
            (item.kind === "OFFICE_WORKER" &&
              mention.kind === "OFFICE_WORKER" &&
              item.officeWorkerId === mention.officeWorkerId),
        )
      ) {
        return current;
      }
      return [...current, mention];
    });
    setComposerBody((current) =>
      current.length > 0 ? `${current} @${mention.label}` : `@${mention.label}`,
    );
  }

  const showThreadList = threadId === undefined;

  return (
    <>
      <PageHeader
        title="Team Chat"
        subtitle="Workspace conversations backed by the OSVA control plane."
      />
      <OfficeSectionNav active="chat" />
      <div className="office-chat-layout">
        <aside
          className={`office-chat-sidebar${showThreadList ? "" : " office-chat-sidebar--mobile-hidden"}`}
          aria-label="Chat threads"
        >
          <SectionPanel title="Threads">
            {threadsQuery.isLoading ? (
              <LoadingBlock label="Loading threads…" />
            ) : null}
            {threadsQuery.isError ? (
              <>
                <ErrorState
                  title="Failed to load threads"
                  error={threadsQuery.error}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void threadsQuery.refetch()}
                >
                  Retry
                </Button>
              </>
            ) : null}
            {visibleThreads.length === 0 && !threadsQuery.isLoading ? (
              <EmptyState
                title="No channels yet"
                description="Start a thread for your workspace."
              />
            ) : null}
            <ul className="office-chat-thread-list">
              {visibleThreads.map((thread) => (
                <li key={thread.id}>
                  <Link
                    to={`/office/chat/${thread.id}`}
                    className={
                      thread.id === threadId
                        ? "office-chat-thread-link is-active"
                        : "office-chat-thread-link"
                    }
                    aria-current={thread.id === threadId ? "page" : undefined}
                  >
                    <span className="office-chat-thread-title">
                      {thread.title}
                    </span>
                    {thread.unreadCount !== undefined &&
                    thread.unreadCount > 0 ? (
                      <span className="office-chat-unread-badge">
                        {thread.unreadCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            {canWrite ? (
              <form
                className="office-chat-new-thread"
                onSubmit={handleCreateThread}
              >
                <label className="visually-hidden" htmlFor="new-thread-title">
                  New thread title
                </label>
                <input
                  id="new-thread-title"
                  className="input"
                  value={newThreadTitle}
                  onChange={(event) => setNewThreadTitle(event.target.value)}
                  placeholder="New channel title"
                  maxLength={200}
                />
                <Button type="submit" disabled={createThread.isPending}>
                  Create thread
                </Button>
              </form>
            ) : null}
          </SectionPanel>
        </aside>
        <section
          className={`office-chat-main${showThreadList ? " office-chat-main--mobile-hidden" : ""}`}
          aria-label="Conversation"
        >
          {threadId === undefined ? (
            <EmptyState
              title="Select a thread"
              description="Choose a channel on the left or create a new one."
            />
          ) : (
            <>
              <header className="office-chat-thread-header">
                <Button
                  type="button"
                  variant="secondary"
                  className="office-chat-back"
                  onClick={() => void navigate("/office/chat")}
                >
                  Back
                </Button>
                <h2>{threadTitle ?? "Thread"}</h2>
              </header>
              {messagesQuery.isLoading ? (
                <LoadingBlock label="Loading messages…" />
              ) : null}
              {messagesQuery.isError ? (
                <>
                  <ErrorState
                    title="Failed to load messages"
                    error={messagesQuery.error}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void messagesQuery.refetch()}
                  >
                    Retry
                  </Button>
                </>
              ) : null}
              {messagesQuery.hasNextPage ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void messagesQuery.fetchNextPage()}
                  disabled={messagesQuery.isFetchingNextPage}
                >
                  Load older messages
                </Button>
              ) : null}
              <ul className="office-chat-messages" role="list">
                {messages.map((message) => {
                  const parent =
                    message.parentMessageId !== undefined
                      ? messages.find(
                          (item) => item.id === message.parentMessageId,
                        )
                      : undefined;
                  return (
                    <li
                      key={message.id}
                      className={
                        message.parentMessageId !== undefined
                          ? "office-chat-message office-chat-message--reply"
                          : "office-chat-message"
                      }
                    >
                      <div className="office-chat-message-meta">
                        <strong>
                          {messageAuthorLabel(
                            message,
                            authQuery.data?.subjectId,
                            membershipLabels,
                          )}
                        </strong>
                        <time dateTime={message.createdAt}>
                          {formatTimestamp(message.createdAt)}
                        </time>
                      </div>
                      {parent !== undefined ? (
                        <p className="office-chat-reply-ref">
                          Replying to #{parent.sequence}:{" "}
                          {parent.body.slice(0, 80)}
                        </p>
                      ) : null}
                      <p className="office-chat-message-body">{message.body}</p>
                      {canWrite ? (
                        <button
                          type="button"
                          className="office-chat-reply-btn"
                          onClick={() => setReplyTo(message)}
                        >
                          Reply
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div ref={messagesEndRef} />
              {replyTo !== undefined ? (
                <p className="office-chat-reply-banner">
                  Replying to message #{replyTo.sequence}
                  <button type="button" onClick={() => setReplyTo(undefined)}>
                    Cancel
                  </button>
                </p>
              ) : null}
              {canWrite ? (
                <form
                  className="office-chat-composer"
                  onSubmit={handleSendMessage}
                >
                  <div
                    className="office-chat-mention-tools"
                    aria-label="Add mention"
                  >
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value.length === 0) {
                          return;
                        }
                        const [kind, id] = value.split(":");
                        if (kind === "human") {
                          addMention({
                            kind: "HUMAN",
                            userId: id!,
                            label: id!,
                          });
                        } else if (kind === "worker") {
                          const worker = workersQuery.data?.items.find(
                            (item) => item.id === id,
                          );
                          addMention({
                            kind: "OFFICE_WORKER",
                            officeWorkerId: id!,
                            label: worker?.name ?? id!,
                          });
                        }
                        event.target.value = "";
                      }}
                    >
                      <option value="">Mention…</option>
                      <optgroup label="Workspace members">
                        {(membershipsQuery.data ?? []).map((row) => (
                          <option
                            key={row.userId}
                            value={`human:${row.userId}`}
                          >
                            {row.userId}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Office workers">
                        {(workersQuery.data?.items ?? []).map((worker) => (
                          <option key={worker.id} value={`worker:${worker.id}`}>
                            {worker.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <label
                    className="visually-hidden"
                    htmlFor="chat-message-body"
                  >
                    Message
                  </label>
                  <textarea
                    id="chat-message-body"
                    className="input office-chat-textarea"
                    rows={4}
                    value={composerBody}
                    onChange={(event) => setComposerBody(event.target.value)}
                    placeholder="Write a message…"
                  />
                  {submitError !== undefined ? (
                    <p className="form-error" role="alert">
                      {submitError}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={postMessage.isPending}>
                    Send
                  </Button>
                </form>
              ) : (
                <p className="office-chat-readonly">
                  Your role can read chat but cannot post messages.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
