import { useCallback, useSyncExternalStore } from "react";

import { coachService, type AgentReply, type AiSessionMessage, type CoachStreamDonePayload } from "../../services/api";
import { DRAFT_PREFIX, isDraftKey, sessionMessagesToChat, type CoachMessage } from "./coach";

/**
 * WB-12 — web's coach-session store (`stores/pendingAiTasks.ts` → useAiCoachSession) for the phone.
 *
 * A thread lives in module memory, keyed by user id + session id, so an answer that is still
 * streaming keeps arriving after the AI Coach screen is closed and is there when it reopens — the
 * same behaviour web gets from its floating panel. Keys carry the user id, so another account
 * signing in on this device never sees these threads (CLAUDE.md user isolation); nothing is written
 * to disk (web's localStorage copy is a tab-restore convenience the app does not need).
 *
 * A new thread starts as a "draft:" key; the server creates the real ChatSession on the first
 * answer and the draft's messages move under that id (web's adoptSessionIfNeeded).
 */
export type CoachStatus = "idle" | "processing" | "completed" | "failed";
export type CoachSessionState = { messages: CoachMessage[]; status: CoachStatus; lastError: string | null };

const EMPTY: CoachSessionState = Object.freeze({ messages: [], status: "idle", lastError: null }) as CoachSessionState;

const sessions = new Map<string, CoachSessionState>();
const cancels = new Map<string, { token: string; cancel: () => void }>();
const listeners = new Set<() => void>();

const bucket = (userId: string, key: string) => `${userId}::${key}`;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getCoachSession = (userId: string, key: string) => sessions.get(bucket(userId, key)) ?? EMPTY;
function setCoachSession(userId: string, key: string, next: CoachSessionState) {
  sessions.set(bucket(userId, key), next);
  emit();
}

let draftSeq = 0;
export const newDraftKey = () => `${DRAFT_PREFIX}${Date.now().toString(36)}-${(draftSeq++).toString(36)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Load a saved thread once — never over a thread that already has local messages (a live stream). */
export function hydrateCoachSession(userId: string, sessionId: string, rows: AiSessionMessage[]) {
  if (getCoachSession(userId, sessionId).messages.length > 0) return;
  setCoachSession(userId, sessionId, { messages: sessionMessagesToChat(rows), status: "idle", lastError: null });
}

/** Seed the greeting bubble of a brand-new thread. */
export function seedCoachGreeting(userId: string, key: string, text: string) {
  if (getCoachSession(userId, key).messages.length > 0) return;
  setCoachSession(userId, key, { messages: [{ id: "greeting", from: "ai", text, time: new Date().toISOString() }], status: "idle", lastError: null });
}

/**
 * A reply from an agent action (choose / confirm / goal image) — web's appendAgentReply. The reply
 * may land in a session other than the one on screen (a draft gets its first real id here), so it
 * is written under `reply.sessionId`, and a draft's messages move there first.
 */
export function appendAgentReply(userId: string, fromKey: string, reply: AgentReply) {
  adopt(userId, fromKey, reply.sessionId);
  const cur = getCoachSession(userId, reply.sessionId);
  const id = `${reply.conversationId}-a`;
  if (cur.messages.some((m) => m.id === id)) return;
  const text = reply.block.type === "ACTION_RESULT" ? "Thao tác đã hoàn tất." : "Kiểm tra thông tin bên dưới.";
  setCoachSession(userId, reply.sessionId, {
    ...cur,
    messages: [...cur.messages, { id, from: "ai", text, time: new Date().toISOString(), structuredBlocks: [reply.block] }],
  });
}

/** Photo + typed question → both bubbles at once (web's appendImageChatExchange). */
export function appendImageChatExchange(userId: string, fromKey: string, reply: AgentReply, userText: string, imageUri: string) {
  adopt(userId, fromKey, reply.sessionId);
  const cur = getCoachSession(userId, reply.sessionId);
  const aiId = `${reply.conversationId}-a`;
  if (cur.messages.some((m) => m.id === aiId)) return;
  const now = new Date().toISOString();
  setCoachSession(userId, reply.sessionId, {
    ...cur,
    messages: [
      ...cur.messages,
      { id: `${reply.conversationId}-u`, from: "user", text: userText || "Phân tích ảnh này", time: now, imageUri },
      { id: aiId, from: "ai", text: "Kiểm tra thông tin bên dưới.", time: now, structuredBlocks: [reply.block] },
    ],
  });
}

function adopt(userId: string, fromKey: string, sessionId: string | undefined) {
  if (!sessionId || fromKey === sessionId || !isDraftKey(fromKey)) return;
  const draft = getCoachSession(userId, fromKey);
  const target = getCoachSession(userId, sessionId);
  if (target.messages.length === 0) sessions.set(bucket(userId, sessionId), draft);
  sessions.delete(bucket(userId, fromKey));
  const c = cancels.get(bucket(userId, fromKey));
  if (c) {
    cancels.delete(bucket(userId, fromKey));
    cancels.set(bucket(userId, sessionId), c);
  }
  emit();
}

/** Drop a thread (after it is archived), cancelling a stream still running into it. */
export function resetCoachSession(userId: string, key: string) {
  cancels.get(bucket(userId, key))?.cancel();
  cancels.delete(bucket(userId, key));
  sessions.delete(bucket(userId, key));
  emit();
}

/**
 * Ask a question in thread `key`. Streams over `POST /ai/ask/stream` (expo/fetch reads the SSE body
 * natively). Returns false when nothing was sent (empty text, or a question already in flight).
 * `onAdopted` fires when a draft thread receives its real session id.
 */
export function sendCoachQuestion(userId: string, key: string, question: string, onAdopted?: (sessionId: string) => void): boolean {
  const text = question.trim();
  if (!text) return false;
  const cur = getCoachSession(userId, key);
  if (cur.status === "processing") return false;

  const placeholderId = `ai-${uid()}`;
  setCoachSession(userId, key, {
    messages: [
      ...cur.messages,
      { id: `u-${uid()}`, from: "user", text, time: new Date().toISOString() },
      { id: placeholderId, from: "ai", text: "AI đang trả lời...", time: new Date().toISOString() },
    ],
    status: "processing",
    lastError: null,
  });

  // The stream may move from the draft key to the real session id mid-flight; `liveKey` follows it.
  let liveKey = key;
  const token = uid();
  const isCurrent = () => cancels.get(bucket(userId, liveKey))?.token === token;
  const update = (fn: (s: CoachSessionState) => CoachSessionState) => {
    if (!isCurrent()) return;
    setCoachSession(userId, liveKey, fn(getCoachSession(userId, liveKey)));
  };
  const patchPlaceholder = (patch: Partial<CoachMessage>) => (s: CoachSessionState) => ({
    ...s,
    messages: s.messages.map((m) => (m.id === placeholderId ? { ...m, ...patch } : m)),
  });

  let firstToken = true;
  const cancel = coachService.chatStream(
    text,
    {
      onStatus: (status) => {
        if (firstToken) update(patchPlaceholder({ text: status }));
      },
      onToken: (tok) => {
        update((s) => ({
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== placeholderId) return m;
            const next = firstToken ? tok : `${m.text}${tok}`;
            return { ...m, text: next };
          }),
        }));
        firstToken = false;
      },
      onDone: (payload: CoachStreamDonePayload) => {
        update((s) => ({
          ...patchPlaceholder({
            evidenceUsed: Array.isArray(payload.evidenceUsed) ? payload.evidenceUsed : [],
            structuredBlocks: payload.structuredBlocks ?? [],
          })(s),
          status: "completed",
          lastError: null,
        }));
        const sessionId = payload.sessionId;
        if (sessionId && isDraftKey(liveKey) && isCurrent()) {
          const from = liveKey;
          adopt(userId, from, sessionId);
          liveKey = sessionId;
          onAdopted?.(sessionId);
        }
        cancels.delete(bucket(userId, liveKey));
      },
      onError: (message) => {
        const err = message || "AI trả lời thất bại, vui lòng thử lại.";
        update((s) => ({ ...patchPlaceholder({ text: `⚠️ ${err}` })(s), status: "failed", lastError: err }));
        cancels.delete(bucket(userId, liveKey));
      },
    },
    isDraftKey(key) ? undefined : key,
  );
  cancels.set(bucket(userId, key), { token, cancel });
  return true;
}

export function useCoachSession(userId: string, key: string) {
  const getSnapshot = useCallback(() => getCoachSession(userId, key), [userId, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test hook — wipe every thread. */
export function __resetCoachStore() {
  cancels.forEach((c) => c.cancel());
  cancels.clear();
  sessions.clear();
  emit();
}
