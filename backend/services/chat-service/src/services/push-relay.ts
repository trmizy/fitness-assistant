import { logger } from "@gym-coach/shared";
import { getInternalUser } from "../clients/auth-service.client";
import { sendPush } from "../clients/user-service.client";

/**
 * Mobile E2/E3 — the phone pushes chat-service asks user-service to send: an incoming call
 * (and the "missed" notice that replaces it), and a new chat message. Best-effort throughout:
 * nothing here may delay or fail a call or a message.
 */

const INTERNAL_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  process.env.INTERNAL_API_SECRET ||
  "dev_internal_service_secret_change_in_production";

/** A CHAT call rings this long (call.handler.ts's ring timeout); the push must not outlive it. */
export const CALL_RING_SECONDS = 30;

const conversationLink = (conversationId: string) => `/client/messages/${conversationId}`;
const callKind = (callType: string) => (callType === "VIDEO" ? "video" : "thoại");

type PushPayload = Parameters<typeof sendPush>[0];

export function incomingCallPush(call: {
  id: string;
  calleeId: string;
  callType: string;
  conversationId: string | null;
}, callerName: string): PushPayload {
  return {
    userId: call.calleeId,
    title: callerName,
    body: `Đang gọi ${callKind(call.callType)} cho bạn…`,
    kind: "CALL",
    link: call.conversationId ? conversationLink(call.conversationId) : undefined,
    data: { callSessionId: call.id, ...(call.conversationId ? { conversationId: call.conversationId } : {}) },
    // Same tag as the missed notice, so that one replaces this one in the shade.
    tag: `call-${call.id}`,
    ttlSeconds: CALL_RING_SECONDS,
  };
}

export function missedCallPush(call: {
  id: string;
  calleeId: string;
  callType: string;
  conversationId: string | null;
}, callerName: string): PushPayload {
  return {
    userId: call.calleeId,
    title: callerName,
    body: `Cuộc gọi ${callKind(call.callType)} nhỡ`,
    kind: "CALL",
    link: call.conversationId ? conversationLink(call.conversationId) : undefined,
    data: { callSessionId: call.id, ...(call.conversationId ? { conversationId: call.conversationId } : {}) },
    tag: `call-${call.id}`,
  };
}

/** One line, at most 120 characters — a notification preview, not the message. */
export function messagePreview(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export function chatMessagePush(
  recipientId: string,
  conversationId: string,
  senderName: string,
  content: string,
): PushPayload {
  return {
    userId: recipientId,
    title: senderName,
    body: messagePreview(content),
    kind: "CHAT",
    link: conversationLink(conversationId),
    data: { conversationId },
    // A busy conversation keeps one entry in the shade showing its latest message.
    tag: `chat-${conversationId}`,
  };
}

// Display names change rarely; one auth-service lookup per sender per few minutes is plenty.
const NAME_TTL_MS = 5 * 60_000;
const nameCache = new Map<string, { name: string | null; at: number }>();

/** "First Last" from auth-service, or null when it has none / cannot be reached. */
export async function displayName(userId: string): Promise<string | null> {
  const hit = nameCache.get(userId);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name;
  let name: string | null = null;
  try {
    const data = await getInternalUser(userId, INTERNAL_SECRET);
    const u = data?.user;
    const full = `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim();
    name = full || null;
  } catch {
    // fall through — the caller has its own fallback
  }
  nameCache.set(userId, { name, at: Date.now() });
  return name;
}

function fire(payload: PushPayload) {
  sendPush(payload, INTERNAL_SECRET).catch((err) =>
    logger.warn({ err: (err as Error).message, userId: payload.userId, kind: payload.kind }, "[push-relay] push not sent"),
  );
}

export function pushIncomingCall(
  call: Parameters<typeof incomingCallPush>[0],
  callerName: string,
): void {
  fire(incomingCallPush(call, callerName));
}

export function pushMissedCall(call: Parameters<typeof missedCallPush>[0], callerName: string): void {
  fire(missedCallPush(call, callerName));
}

/** Every participant except the sender gets one push. */
export async function pushNewMessage(params: {
  conversationId: string;
  senderId: string;
  content: string;
  participantIds: string[];
}): Promise<void> {
  const recipients = params.participantIds.filter((id) => id !== params.senderId);
  if (recipients.length === 0) return;
  const senderName = (await displayName(params.senderId)) ?? "Tin nhắn mới";
  for (const id of recipients) fire(chatMessagePush(id, params.conversationId, senderName, params.content));
}
