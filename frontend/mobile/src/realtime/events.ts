/**
 * Realtime event names + payload types shared with the gateway socket. Ported from web's
 * `realtime/events.ts`; names must match `backend/gateway/src/socket/events.ts` exactly.
 */
export const REALTIME_EVENTS = {
  notificationNew: "notification:new",
  chatMessageNew: "chat:message:new",
  chatMessageNewLegacy: "chat:new_message",
  chatConversationUpdatedLegacy: "chat:conversation_updated",
  chatTyping: "chat:typing",
  chatError: "chat:error",
  aiCoachChunk: "ai:coach:chunk",
  aiCoachDone: "ai:coach:done",
  aiCoachError: "ai:coach:error",
  userPresenceUpdate: "user:presence:update",
  chatJoinConversation: "chat:join_conversation",
  chatLeaveConversation: "chat:leave_conversation",
  chatMessageSend: "chat:message:send",
} as const;

export type RealtimeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type RealtimeChatMessage = {
  id: string;
  conversationId: string;
  authorId?: string;
  senderId?: string;
  content: string;
  createdAt: string;
};
