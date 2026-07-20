import { apiClient } from "./client";

export interface EvidenceUsedItem {
  title: string;
  source_url?: string;
  category?: string;
  source_type?: string;
  summary?: string;
}

export interface AskResponseData {
  conversationId: string;
  sessionId: string;
  answer: string;
  evidenceUsed?: EvidenceUsedItem[];
  adjustmentReasons?: string[];
  safetyNotes?: string[];
  timing?: unknown;
  fallbackReason?: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  lastMessageAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  userId: string;
  sessionId: string;
  question: string;
  answer: string;
  createdAt: string;
  evidenceUsed?: EvidenceUsedItem[];
}

// LLM có thể chậm (30B model) — timeout dài + cho phép huỷ (AbortController).
const ASK_TIMEOUT_MS = 180_000;

export const coachApi = {
  ask(question: string, sessionId?: string, signal?: AbortSignal) {
    return apiClient
      .post<{ success: true; data: AskResponseData }>(
        "/ai/ask",
        { question, sessionId },
        { timeout: ASK_TIMEOUT_MS, signal },
      )
      .then((r) => r.data.data);
  },

  listSessions(limit = 20) {
    return apiClient
      .get<{ success: true; data: { sessions: ChatSession[] } }>("/ai/sessions", {
        params: { limit },
      })
      .then((r) => r.data.data.sessions);
  },

  // GET /ai/sessions/:id/messages -> { data: { session, messages } }
  getSessionMessages(sessionId: string) {
    return apiClient
      .get<{ success: true; data: { session: ChatSession; messages: SessionMessage[] } }>(
        `/ai/sessions/${sessionId}/messages`,
      )
      .then((r) => r.data.data);
  },

  renameSession(sessionId: string, title: string) {
    return apiClient.patch(`/ai/sessions/${sessionId}`, { title }).then((r) => r.data);
  },

  archiveSession(sessionId: string) {
    return apiClient.delete(`/ai/sessions/${sessionId}`).then((r) => r.data);
  },
};
