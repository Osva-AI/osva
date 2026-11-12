import type { IncomingMessage, ServerResponse } from "node:http";
import type { OfficeThreadId } from "@osva-ai/contracts";
import {
  createOfficeMessageRequestSchema,
  createOfficeThreadRequestSchema,
  inboxListResourceSchema,
  inboxItemReadStateResourceSchema,
  inboxReadStateMutationResourceSchema,
  inboxReadStateResourceSchema,
  listInboxQuerySchema,
  listOfficeMessagesQuerySchema,
  listOfficeThreadsQuerySchema,
  officeMessageListResourceSchema,
  officeThreadListResourceSchema,
  officeThreadResourceSchema,
  parseOfficeCollaborationPageLimit,
  updateInboxReadStateRequestSchema,
} from "@osva-ai/contracts/schemas";
import type {
  InboxItemReadState,
  InboxReadState,
  OfficeCollaborationApplication,
  OfficeMessage,
  OfficeThread,
} from "@osva/domain";

import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface OfficeCollaborationHttpServices {
  readonly collaboration: OfficeCollaborationApplication;
}

type OfficeCollaborationRoute =
  | { readonly kind: "threads" }
  | { readonly kind: "thread"; readonly threadId: OfficeThreadId }
  | {
      readonly kind: "threadMessages";
      readonly threadId: OfficeThreadId;
    }
  | { readonly kind: "inbox" }
  | { readonly kind: "inboxReadState" };

export function matchOfficeCollaborationRoute(
  path: string,
): OfficeCollaborationRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== "v1" || segments[1] !== "office") {
    return undefined;
  }

  if (segments[2] === "threads") {
    if (segments.length === 3) {
      return { kind: "threads" };
    }
    if (segments.length === 4) {
      return { kind: "thread", threadId: segments[3] as OfficeThreadId };
    }
    if (segments.length === 5 && segments[4] === "messages") {
      return {
        kind: "threadMessages",
        threadId: segments[3] as OfficeThreadId,
      };
    }
  }

  if (segments[2] === "inbox") {
    if (segments.length === 3) {
      return { kind: "inbox" };
    }
    if (segments.length === 4 && segments[3] === "read-state") {
      return { kind: "inboxReadState" };
    }
  }

  return undefined;
}

export async function handleOfficeCollaborationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: OfficeCollaborationHttpServices,
): Promise<boolean> {
  const route = matchOfficeCollaborationRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchOfficeCollaborationRoute(
      request,
      response,
      method,
      route,
      searchParams,
      services,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

async function dispatchOfficeCollaborationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: OfficeCollaborationRoute,
  searchParams: URLSearchParams,
  services: OfficeCollaborationHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();

  if (route.kind === "threads") {
    if (method === "GET") {
      const parsed = listOfficeThreadsQuerySchema.safeParse({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const listed = await services.collaboration.listOfficeThreads.execute(
        scope,
        {
          limit: parseOfficeCollaborationPageLimit(parsed.data.limit),
          cursor: parsed.data.cursor,
        },
      );
      sendJson(
        response,
        200,
        toOfficeThreadListResource(
          listed.threads,
          listed.unreadByThreadId,
          listed.nextCursor,
        ),
      );
      return;
    }

    if (method === "POST") {
      const parsed = createOfficeThreadRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.collaboration.createOfficeThread.execute(
        scope,
        parsed.data,
      );
      sendJson(response, 201, toOfficeThreadResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "thread") {
    if (method === "GET") {
      const thread = await services.collaboration.getOfficeThread.execute(
        scope,
        route.threadId,
      );
      sendJson(response, 200, toOfficeThreadResource(thread));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "threadMessages") {
    if (method === "GET") {
      const parsed = listOfficeMessagesQuerySchema.safeParse({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const listed = await services.collaboration.listOfficeMessages.execute(
        scope,
        route.threadId,
        {
          limit: parseOfficeCollaborationPageLimit(parsed.data.limit),
          cursor: parsed.data.cursor,
        },
      );
      sendJson(
        response,
        200,
        officeMessageListResourceSchema.parse({
          items: listed.messages.map(toOfficeMessageResource),
          nextCursor: listed.nextCursor,
        }),
      );
      return;
    }

    if (method === "POST") {
      const parsed = createOfficeMessageRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.collaboration.appendOfficeMessage.execute(
        scope,
        {
          threadId: route.threadId,
          ...parsed.data,
        },
      );
      sendJson(response, 201, toOfficeMessageResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "inbox") {
    if (method === "GET") {
      const parsed = listInboxQuerySchema.safeParse({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const listed = await services.collaboration.listInbox.execute(scope, {
        limit: parseOfficeCollaborationPageLimit(parsed.data.limit),
        cursor: parsed.data.cursor,
      });
      sendJson(
        response,
        200,
        inboxListResourceSchema.parse({
          items: listed.items,
          nextCursor: listed.nextCursor,
        }),
      );
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "inboxReadState") {
    if (method === "PATCH") {
      const parsed = updateInboxReadStateRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.collaboration.updateInboxReadState.execute(
        scope,
        parsed.data,
      );
      sendJson(response, 200, toInboxReadStateMutationResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "PATCH" },
    );
  }
}

function toOfficeThreadResource(thread: OfficeThread, unreadCount?: number) {
  return officeThreadResourceSchema.parse({
    id: thread.id,
    workspaceId: thread.workspaceId,
    title: thread.title,
    type: thread.type,
    teamId: thread.teamId,
    goalId: thread.goalId,
    createdByUserId: thread.createdByUserId,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    latestMessageSequence: thread.latestMessageSequence,
    unreadCount,
  });
}

function toOfficeThreadListResource(
  threads: readonly OfficeThread[],
  unreadByThreadId: Readonly<Record<string, number>>,
  nextCursor?: string,
) {
  return officeThreadListResourceSchema.parse({
    items: threads.map((thread) =>
      toOfficeThreadResource(thread, unreadByThreadId[thread.id]),
    ),
    nextCursor,
  });
}

function toOfficeMessageResource(message: OfficeMessage) {
  return {
    id: message.id,
    workspaceId: message.workspaceId,
    threadId: message.threadId,
    sequence: message.sequence,
    authorType: message.authorType,
    authorUserId: message.authorUserId,
    body: message.body,
    parentMessageId: message.parentMessageId,
    mentions: message.mentions,
    references: message.references,
    createdAt: message.createdAt.toISOString(),
  };
}

function toInboxReadStateResource(state: InboxReadState) {
  return inboxReadStateResourceSchema.parse({
    threadId: state.threadId,
    lastReadSequence: state.lastReadSequence,
    updatedAt: state.updatedAt.toISOString(),
  });
}

function toInboxItemReadStateResource(state: InboxItemReadState) {
  return inboxItemReadStateResourceSchema.parse({
    itemId: state.itemId,
    updatedAt: state.updatedAt.toISOString(),
  });
}

function toInboxReadStateMutationResource(
  state: InboxReadState | InboxItemReadState,
) {
  const resource =
    "threadId" in state
      ? toInboxReadStateResource(state)
      : toInboxItemReadStateResource(state);
  return inboxReadStateMutationResourceSchema.parse(resource);
}

export const V1_OFFICE_COLLABORATION_HTTP_ROUTES = [
  { method: "GET", path: "/v1/office/threads" },
  { method: "POST", path: "/v1/office/threads" },
  { method: "GET", path: "/v1/office/threads/:threadId" },
  { method: "GET", path: "/v1/office/threads/:threadId/messages" },
  { method: "POST", path: "/v1/office/threads/:threadId/messages" },
  { method: "GET", path: "/v1/office/inbox" },
  { method: "PATCH", path: "/v1/office/inbox/read-state" },
] as const;
