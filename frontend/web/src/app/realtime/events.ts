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
  aiPlanSubscribe: "ai:plan:subscribe",
  aiPlanUnsubscribe: "ai:plan:unsubscribe",
  aiPlanJobCreated: "ai:plan:job:created",
  aiPlanJobProgress: "ai:plan:job:progress",
  aiPlanJobCompleted: "ai:plan:job:completed",
  aiPlanJobFailed: "ai:plan:job:failed",
  dashboardMetricsUpdate: "dashboard:metrics:update",
  userPresenceUpdate: "user:presence:update",
  chatJoinConversation: "chat:join_conversation",
  chatLeaveConversation: "chat:leave_conversation",
  chatMessageSend: "chat:message:send",
  chatMessageSendLegacy: "chat:send_message",
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

export type AiJobRealtimePayload = {
  jobId: string;
  planId?: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  progressPercent?: number;
  message?: string;
  result?: unknown;
  error?: string | null;
};
