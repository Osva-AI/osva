import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { OfficeMessageMentionV1 } from "@osva-ai/contracts";

import {
  workspaceIdForRequest,
  workspaceMutationFetch,
  workspaceScopedFetch,
} from "../lib/console-api";
import { createMessageIdempotencyKey } from "../lib/office-chat-idempotency";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

const COLLAB_STALE_MS = 15_000;
const COLLAB_POLL_MS = 20_000;
const MESSAGE_PAGE_SIZE = 50;

export interface OfficeThreadResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly type: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestMessageSequence: number;
  readonly unreadCount?: number;
}

export interface OfficeThreadListResource {
  readonly items: readonly OfficeThreadResource[];
  readonly nextCursor?: string;
}

export interface OfficeMessageResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly sequence: number;
  readonly authorType: string;
  readonly authorUserId?: string;
  readonly body: string;
  readonly parentMessageId?: string;
  readonly mentions: readonly OfficeMessageMentionV1[];
  readonly references: readonly unknown[];
  readonly createdAt: string;
}

export interface OfficeMessageListResource {
  readonly items: readonly OfficeMessageResource[];
  readonly nextCursor?: string;
}

export type InboxItemKind = "CHAT_MESSAGE" | "CHAT_MENTION";

export interface InboxItemResource {
  readonly id: string;
  readonly kind: InboxItemKind;
  readonly occurredAt: string;
  readonly unread: boolean;
  readonly title: string;
  readonly summary?: string;
  readonly threadId?: string;
  readonly messageId?: string;
}

export interface InboxListResource {
  readonly items: readonly InboxItemResource[];
  readonly nextCursor?: string;
}

export interface WorkspaceMembershipDirectoryRow {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
}

function threadsPath(limit?: number, cursor?: string): string {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return `/api/v1/office/threads${suffix}`;
}

function messagesPath(
  threadId: string,
  limit?: number,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return `/api/v1/office/threads/${encodeURIComponent(threadId)}/messages${suffix}`;
}

function assertWorkspaceMatches<T extends { readonly workspaceId: string }>(
  workspaceId: string,
  items: readonly T[],
): void {
  for (const item of items) {
    if (item.workspaceId !== workspaceId) {
      throw new Error(
        "Workspace isolation violation in office collaboration data.",
      );
    }
  }
}

function inboxPath(limit?: number, cursor?: string): string {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return `/api/v1/office/inbox${suffix}`;
}

export function useOfficeThreadsQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "threads"],
    enabled: workspaceId !== undefined,
    staleTime: COLLAB_STALE_MS,
    refetchInterval: COLLAB_POLL_MS,
    queryFn: async () => {
      const data = await workspaceScopedFetch<OfficeThreadListResource>(
        workspaceId,
        threadsPath(100),
      );
      if (workspaceId !== undefined) {
        assertWorkspaceMatches(workspaceId, data.items);
      }
      return data;
    },
  });
}

export function useOfficeThreadQuery(threadId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "threads", threadId],
    enabled:
      workspaceId !== undefined &&
      threadId !== undefined &&
      threadId.length > 0,
    staleTime: COLLAB_STALE_MS,
    queryFn: async () => {
      const data = await workspaceScopedFetch<OfficeThreadResource>(
        workspaceId,
        `/api/v1/office/threads/${encodeURIComponent(threadId!)}`,
      );
      if (workspaceId !== undefined && data.workspaceId !== workspaceId) {
        throw new Error("Workspace isolation violation in office thread.");
      }
      return data;
    },
  });
}

export function useOfficeThreadMessagesQuery(threadId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "threads", threadId, "messages"],
    enabled:
      workspaceId !== undefined &&
      threadId !== undefined &&
      threadId.length > 0,
    staleTime: COLLAB_STALE_MS,
    refetchInterval: COLLAB_POLL_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeMessageListResource>(
        workspaceId,
        messagesPath(threadId!, MESSAGE_PAGE_SIZE),
      ),
  });
}

export function useOfficeThreadMessagesInfiniteQuery(threadId: string) {
  const workspaceId = useWorkspaceQueryScope();
  return useInfiniteQuery({
    queryKey: ["office", workspaceId, "threads", threadId, "messages", "pages"],
    enabled: workspaceId !== undefined && threadId.length > 0,
    staleTime: COLLAB_STALE_MS,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const data = await workspaceScopedFetch<OfficeMessageListResource>(
        workspaceId,
        messagesPath(threadId, MESSAGE_PAGE_SIZE, pageParam),
      );
      if (workspaceId !== undefined) {
        assertWorkspaceMatches(workspaceId, data.items);
      }
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useOfficeInboxQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "inbox"],
    enabled: workspaceId !== undefined,
    staleTime: COLLAB_STALE_MS,
    refetchInterval: COLLAB_POLL_MS,
    queryFn: () =>
      workspaceScopedFetch<InboxListResource>(workspaceId, inboxPath(100)),
  });
}

export function useWorkspaceMembershipDirectoryQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["auth", "memberships", workspaceId, "directory"],
    enabled: workspaceId !== undefined,
    staleTime: 60_000,
    queryFn: async () => {
      const body = await workspaceScopedFetch<{
        memberships: WorkspaceMembershipDirectoryRow[];
      }>(
        workspaceId,
        `/api/v1/auth/workspaces/${encodeURIComponent(workspaceId!)}/memberships`,
      );
      return body.memberships;
    },
  });
}

export function useCreateOfficeThreadMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: { readonly title: string }) => {
      const pinnedWorkspace = workspaceIdForRequest(workspaceId);
      return workspaceMutationFetch<OfficeThreadResource>(
        "/api/v1/office/threads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        { workspaceId: pinnedWorkspace },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "threads"],
      });
    },
  });
}

export interface PostOfficeMessageInput {
  readonly threadId: string;
  readonly body: string;
  readonly parentMessageId?: string;
  readonly mentions?: readonly OfficeMessageMentionV1[];
  readonly idempotencyKey: string;
}

export function usePostOfficeMessageMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: PostOfficeMessageInput) => {
      const pinnedWorkspace = workspaceIdForRequest(workspaceId);
      return workspaceMutationFetch<OfficeMessageResource>(
        `/api/v1/office/threads/${encodeURIComponent(input.threadId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: input.body,
            parentMessageId: input.parentMessageId,
            mentions: input.mentions,
            idempotencyKey: input.idempotencyKey,
          }),
        },
        { workspaceId: pinnedWorkspace },
      );
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "threads"],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          "office",
          workspaceId,
          "threads",
          variables.threadId,
          "messages",
        ],
      });
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "inbox"],
      });
    },
  });
}

export { createMessageIdempotencyKey };

export function useUpdateInboxReadStateMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: {
      readonly threadId: string;
      readonly lastReadSequence: number;
    }) => {
      const pinnedWorkspace = workspaceIdForRequest(workspaceId);
      return workspaceMutationFetch<{
        threadId: string;
        lastReadSequence: number;
      }>(
        "/api/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        { workspaceId: pinnedWorkspace },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "threads"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "inbox"],
      });
    },
  });
}
