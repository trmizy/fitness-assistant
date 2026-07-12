export type SocketUserRole = "ADMIN" | "CUSTOMER" | "PT";

export type SocketUser = {
  id: string;
  email?: string;
  role: SocketUserRole;
};

export const SERVER_EVENTS = {
  notificationNew: "notification:new",
  chatMessageNew: "chat:message:new",
  chatMessageNewLegacy: "chat:new_message",
  chatConversationUpdatedLegacy: "chat:conversation_updated",
  chatTyping: "chat:typing",
  chatError: "chat:error",
  aiCoachChunk: "ai:coach:chunk",
  aiCoachDone: "ai:coach:done",
  aiCoachError: "ai:coach:error",
  aiPlanJobCreated: "ai:plan:job:created",
  aiPlanJobProgress: "ai:plan:job:progress",
  aiPlanJobCompleted: "ai:plan:job:completed",
  aiPlanJobFailed: "ai:plan:job:failed",
  dashboardMetricsUpdate: "dashboard:metrics:update",
  userPresenceUpdate: "user:presence:update",
} as const;

export const CLIENT_EVENTS = {
  chatJoinConversation: "chat:join_conversation",
  chatLeaveConversation: "chat:leave_conversation",
  chatMessageSend: "chat:message:send",
  chatMessageSendLegacy: "chat:send_message",
  chatTyping: "chat:typing",
  aiPlanSubscribe: "ai:plan:subscribe",
  aiPlanUnsubscribe: "ai:plan:unsubscribe",
  dashboardSubscribe: "dashboard:subscribe",
  dashboardUnsubscribe: "dashboard:unsubscribe",
} as const;

export type NotificationPayload = {
  id: string;
  title?: string;
  message?: string;
  unread?: boolean;
  createdAt?: string;
  [key: string]: unknown;
};

export type ChatMessagePayload = {
  id: string;
  conversationId: string;
  authorId?: string;
  senderId?: string;
  content: string;
  createdAt: string;
};

export type ChatTypingPayload = {
  conversationId: string;
  userId: string;
  typing: boolean;
};

export type AiCoachChunkPayload = {
  conversationId?: string;
  requestId?: string;
  chunk: string;
};

export type AiCoachDonePayload = {
  conversationId?: string;
  requestId?: string;
  response?: string;
  evidenceUsed?: unknown[];
  fallbackReason?: string;
};

export type AiCoachErrorPayload = {
  conversationId?: string;
  requestId?: string;
  message: string;
  code?: string;
};

export type AiPlanJobPayload = {
  jobId: string;
  planId?: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  progressPercent?: number;
  message?: string;
  result?: unknown;
  error?: string | null;
};

export type DashboardMetricsPayload = {
  scope?: "admin" | "trainer" | "client";
  metrics: Record<string, unknown>;
  updatedAt: string;
};

export type PresencePayload = {
  userId: string;
  status: "online" | "offline";
  updatedAt: string;
};
