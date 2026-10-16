import { ROLE_HOME } from "../../config/landing";
import type { UserRole } from "../../context/AppContext";
import { notificationRoute } from "../notifications/notifications";

/**
 * Phase 14.2 — the pure half of a tapped push notification.
 *
 * The server (user-service push.service.ts) puts routing hints in the FCM `data` block as
 * strings: the notification's id, the user it was written for, and the same `link` /
 * `entityType` the in-app list already routes by.
 */
export type PushData = {
  notificationId: string | null;
  userId: string | null;
  link: string | null;
  entityType: string | null;
  /** What happened ("CONTRACT_REQUESTED", …) — says which lists the push has made stale. */
  eventType: string | null;
  /** E2/E3 — chat-service's realtime nudges (no notifications row): "CALL" | "CHAT", else null. */
  kind: "CALL" | "CHAT" | null;
  callSessionId: string | null;
};

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

export function readPushData(raw: unknown): PushData {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    notificationId: str(data.notificationId),
    userId: str(data.userId),
    link: str(data.link),
    entityType: str(data.entityType),
    eventType: str(data.eventType),
    kind: data.kind === "CALL" || data.kind === "CHAT" ? data.kind : null,
    callSessionId: str(data.callSessionId),
  };
}

const CONVERSATION_LINK = /^\/client\/messages\/[A-Za-z0-9_-]+$/;

/**
 * A call or chat push is about the conversation, which the app already shows live while it is
 * open (the ringing overlay, the message list) — so no banner on top of it then. In the
 * background the system draws these itself; this handler only runs in the foreground.
 */
export function showsWhileOpen(data: PushData): boolean {
  return data.kind === null;
}

/**
 * A push is only acted on for the account it was written for. The token row moves to whoever
 * signs in next, but a notification already on its way — or still sitting in the shade — may
 * belong to the previous account: it must neither pop up nor open anything for the new one.
 */
export function isForCurrentUser(data: PushData, currentUserId: string | null | undefined): boolean {
  return !!data.userId && !!currentUserId && data.userId === currentUserId;
}

/**
 * Where a tap goes. A client (or a PT on a client-side link — a PT is also a client) lands where
 * the in-app list would send them, else on the list itself; every other workspace lands on its
 * home, since only the client list has per-notification routes today. The route still passes
 * through that workspace's RequireRole guard like any other navigation.
 */
export function pushTapRoute(
  data: PushData,
  currentUserId: string | null | undefined,
  role: UserRole | null | undefined,
): string | null {
  if (!role || !isForCurrentUser(data, currentUserId)) return null;
  // E2/E3: straight to the conversation (a PT chats from the client-side screen too). An incoming
  // call needs no route of its own — the overlay rings over whatever screen this opens (call:sync).
  if (data.kind) {
    if ((role === "client" || role === "pt") && data.link && CONVERSATION_LINK.test(data.link)) return data.link;
    return ROLE_HOME[role];
  }
  const clientSide = role === "client" || (role === "pt" && (data.link ?? "").startsWith("/client"));
  if (clientSide) {
    return notificationRoute({ link: data.link, entityType: data.entityType }) ?? "/client/notifications";
  }
  return ROLE_HOME[role];
}
