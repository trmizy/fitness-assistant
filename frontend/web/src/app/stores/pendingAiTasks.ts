import { useEffect, useSyncExternalStore } from "react";
import {
  planService,
  coachService,
  type CoachEvidenceItem,
  type CoachStreamDonePayload,
  type AiSessionMessage,
} from "../services/api";

export type PendingAiTaskKind = "plan-generate" | "plan-adjust" | "chat-ask";
export type PendingAiTaskStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface PendingAiTask {
  id: string;
  userId: string;
  kind: PendingAiTaskKind;
  title: string;
  status: PendingAiTaskStatus;
  createdAt: string;
  updatedAt: string;
  link: string;
  jobId?: string | null;
  planId?: string | null;
  conversationId?: string | null;
  goal?: string;
  daysPerWeek?: number;
  durationWeeks?: number;
  error?: string | null;
}

export interface AiChatMessage {
  id: number | string;
  from: "user" | "ai";
  text: string;
  time: string;
  evidenceUsed?: CoachEvidenceItem[];
}

export interface AiCoachSessionState {
  messages: AiChatMessage[];
  status: "idle" | "processing" | "completed" | "failed";
  activeTaskId: string | null;
  lastError: string | null;
  updatedAt: string;
}

const TASK_STORAGE_PREFIX = "ai_pending_tasks_v1";
const COACH_STORAGE_PREFIX = "ai_coach_session_v1";
// Sentinel sessionKey prefix for a thread that hasn't been adopted by the
// server yet (no real ChatSession row exists until the first message lands).
const DRAFT_SESSION_PREFIX = "draft:";

const taskTimers = new Map<string, ReturnType<typeof setInterval>>();
// Keyed by `${userId}:${sessionKey}` — one entry per open chat thread, not per user.
const coachRequests = new Map<string, { token: string; cancel: () => void }>();
const taskCache = new Map<string, PendingAiTask[]>();
const coachCache = new Map<string, AiCoachSessionState>();
const listeners = new Set<() => void>();

function nowIso(): string {
  return new Date().toISOString();
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function taskStorageKey(userId: string): string {
  return `${TASK_STORAGE_PREFIX}:${userId}`;
}

function coachKey(userId: string, sessionKey: string): string {
  return `${userId}:${sessionKey}`;
}

function coachStorageKey(userId: string, sessionKey: string): string {
  return `${COACH_STORAGE_PREFIX}:${userId}:${sessionKey}`;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

function persistTasks(userId: string): void {
  writeJson(taskStorageKey(userId), taskCache.get(userId) ?? []);
}

function persistCoach(userId: string, sessionKey: string): void {
  writeJson(
    coachStorageKey(userId, sessionKey),
    coachCache.get(coachKey(userId, sessionKey)) ?? null,
  );
}

function normalizeTask(task: PendingAiTask): PendingAiTask {
  return {
    ...task,
    updatedAt: task.updatedAt || task.createdAt || nowIso(),
    createdAt: task.createdAt || nowIso(),
  };
}

function getUserTasks(userId?: string): PendingAiTask[] {
  if (!userId) return [];
  if (!taskCache.has(userId)) {
    const persisted = readJson<PendingAiTask[]>(taskStorageKey(userId), []);
    taskCache.set(
      userId,
      Array.isArray(persisted) ? persisted.map(normalizeTask) : [],
    );
  }
  return taskCache.get(userId) ?? [];
}

function setUserTasks(userId: string, tasks: PendingAiTask[]): void {
  taskCache.set(userId, tasks.map(normalizeTask));
  persistTasks(userId);
  emit();
}

function emptyCoachSession(): AiCoachSessionState {
  return {
    messages: [],
    status: "idle",
    activeTaskId: null,
    lastError: null,
    updatedAt: nowIso(),
  };
}

function getCoachSession(
  userId?: string,
  sessionKey?: string,
): AiCoachSessionState {
  if (!userId || !sessionKey) return emptyCoachSession();

  const key = coachKey(userId, sessionKey);
  if (!coachCache.has(key)) {
    const persisted = readJson<AiCoachSessionState | null>(
      coachStorageKey(userId, sessionKey),
      null,
    );
    coachCache.set(key, persisted ?? emptyCoachSession());
  }

  return coachCache.get(key) ?? emptyCoachSession();
}

function setCoachSession(
  userId: string,
  sessionKey: string,
  session: AiCoachSessionState,
): void {
  coachCache.set(coachKey(userId, sessionKey), session);
  persistCoach(userId, sessionKey);
  emit();
}

function deleteCoachSession(userId: string, sessionKey: string): void {
  coachCache.delete(coachKey(userId, sessionKey));
  if (isBrowser()) {
    localStorage.removeItem(coachStorageKey(userId, sessionKey));
  }
}

function isPendingStatus(status: PendingAiTaskStatus): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

function startPlanPolling(userId: string, taskId: string): void {
  const timerKey = `${userId}:${taskId}`;
  if (taskTimers.has(timerKey)) return;

  const poll = async () => {
    const tasks = getUserTasks(userId);
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.jobId || !isPendingStatus(task.status)) {
      const timer = taskTimers.get(timerKey);
      if (timer) clearInterval(timer);
      taskTimers.delete(timerKey);
      return;
    }

    try {
      const status = await planService.getJobStatus(task.jobId);
      const nextStatus: PendingAiTaskStatus =
        status.status === "FAILED"
          ? "FAILED"
          : status.status === "COMPLETED"
            ? "COMPLETED"
            : "PROCESSING";

      const nextTask: PendingAiTask = {
        ...task,
        status: nextStatus,
        planId: status.planId ?? task.planId ?? null,
        error: status.failReason ?? null,
        updatedAt: nowIso(),
      };

      setUserTasks(
        userId,
        tasks.map((item) => (item.id === taskId ? nextTask : item)),
      );

      if (nextStatus === "COMPLETED" || nextStatus === "FAILED") {
        const timer = taskTimers.get(timerKey);
        if (timer) clearInterval(timer);
        taskTimers.delete(timerKey);
      }
    } catch (error: any) {
      if (error?.response?.status === 404) {
        // Job not found means it's gone from backend (e.g. DB reset or failed to create properly)
        updateTask(userId, taskId, {
          status: "FAILED",
          error: "Kế hoạch không tồn tại hoặc đã bị xóa.",
          updatedAt: nowIso(),
        });
        const timer = taskTimers.get(timerKey);
        if (timer) clearInterval(timer);
        taskTimers.delete(timerKey);
      }
      // Keep polling for other temporary network/API failures
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, 2500);
  taskTimers.set(timerKey, timer);
}

function upsertTask(
  userId: string,
  task: Omit<PendingAiTask, "userId" | "createdAt" | "updatedAt"> &
    Partial<Pick<PendingAiTask, "createdAt" | "updatedAt">>,
): PendingAiTask {
  const current = getUserTasks(userId);
  const nextTask: PendingAiTask = normalizeTask({
    ...task,
    userId,
    createdAt: task.createdAt ?? nowIso(),
    updatedAt: task.updatedAt ?? nowIso(),
  });
  const next = current.some((item) => item.id === nextTask.id)
    ? current.map((item) => (item.id === nextTask.id ? nextTask : item))
    : [nextTask, ...current];
  setUserTasks(userId, next);
  if (isPendingStatus(nextTask.status) && nextTask.kind !== "chat-ask") {
    startPlanPolling(userId, nextTask.id);
  }
  return nextTask;
}

function updateTask(
  userId: string,
  taskId: string,
  patch: Partial<PendingAiTask>,
): void {
  const current = getUserTasks(userId);
  const next = current.map((item) =>
    item.id === taskId
      ? normalizeTask({ ...item, ...patch, updatedAt: nowIso() })
      : item,
  );
  setUserTasks(userId, next);
}

function removeTask(userId: string, taskId: string): void {
  const current = getUserTasks(userId);
  const next = current.filter((item) => item.id !== taskId);
  setUserTasks(userId, next);
  const timerKey = `${userId}:${taskId}`;
  const timer = taskTimers.get(timerKey);
  if (timer) clearInterval(timer);
  taskTimers.delete(timerKey);
}

export function clearPendingAiState(userId: string): void {
  const tasks = taskCache.get(userId) ?? [];
  for (const task of tasks) {
    const timerKey = `${userId}:${task.id}`;
    const timer = taskTimers.get(timerKey);
    if (timer) clearInterval(timer);
    taskTimers.delete(timerKey);
  }
  taskCache.delete(userId);

  // coachCache/coachRequests are keyed `${userId}:${sessionKey}` — one entry
  // per open chat thread, so sweep every entry belonging to this user rather
  // than a single fixed key.
  const prefix = `${userId}:`;
  for (const key of Array.from(coachCache.keys())) {
    if (key.startsWith(prefix)) coachCache.delete(key);
  }
  for (const key of Array.from(coachRequests.keys())) {
    if (key.startsWith(prefix)) {
      coachRequests.get(key)?.cancel?.();
      coachRequests.delete(key);
    }
  }

  if (isBrowser()) {
    localStorage.removeItem(taskStorageKey(userId));
    const coachPrefix = `${COACH_STORAGE_PREFIX}:${userId}:`;
    for (const storageKey of Object.keys(localStorage)) {
      if (storageKey.startsWith(coachPrefix)) {
        localStorage.removeItem(storageKey);
      }
    }
  }
  emit();
}

export function usePendingAiTasks(userId?: string) {
  const tasks = useSyncExternalStore(
    subscribe,
    () => getUserTasks(userId),
    () => [],
  );

  useEffect(() => {
    if (!userId) return;
    for (const task of tasks) {
      if (task.kind !== "chat-ask" && isPendingStatus(task.status)) {
        startPlanPolling(userId, task.id);
      }
    }
  }, [tasks, userId]);

  return {
    tasks,
    pendingCount: tasks.filter((task) => isPendingStatus(task.status)).length,
    hasPending: tasks.some((task) => isPendingStatus(task.status)),
    upsertTask: (
      task: Omit<PendingAiTask, "userId" | "createdAt" | "updatedAt">,
    ) => (userId ? upsertTask(userId, task) : null),
    updateTask: (taskId: string, patch: Partial<PendingAiTask>) =>
      userId ? updateTask(userId, taskId, patch) : undefined,
    removeTask: (taskId: string) =>
      userId ? removeTask(userId, taskId) : undefined,
  };
}

/** Generates a fresh local placeholder key for a not-yet-adopted "New Chat" thread. */
export function newDraftSessionKey(): string {
  return `${DRAFT_SESSION_PREFIX}${safeUuid()}`;
}

function isDraftSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(DRAFT_SESSION_PREFIX);
}

/** Converts server-persisted turns (GET /ai/sessions/:id/messages) into the
 * store's message shape. Seeds only when the target bucket is empty so a
 * background refetch never clobbers a thread the user is actively typing in. */
export function hydrateSessionMessages(
  userId: string,
  sessionId: string,
  conversations: AiSessionMessage[],
): void {
  const current = getCoachSession(userId, sessionId);
  if (current.messages.length > 0) return;

  const messages: AiChatMessage[] = conversations.flatMap((c) => [
    { id: `${c.id}-q`, from: "user" as const, text: c.question, time: c.createdAt },
    {
      id: `${c.id}-a`,
      from: "ai" as const,
      text: c.answer,
      time: c.createdAt,
      evidenceUsed: c.evidenceUsed,
    },
  ]);

  setCoachSession(userId, sessionId, {
    messages,
    status: "idle",
    activeTaskId: null,
    lastError: null,
    updatedAt: nowIso(),
  });
}

export function useAiCoachSession(userId?: string, sessionKey?: string) {
  const key = sessionKey ?? "";
  const session = useSyncExternalStore(
    subscribe,
    () => getCoachSession(userId, key),
    () => emptyCoachSession(),
  );

  const setInitialMessage = (message: AiChatMessage): void => {
    if (!userId || !key) return;
    const current = getCoachSession(userId, key);
    if (current.messages.length > 0) return;
    setCoachSession(userId, key, {
      ...current,
      messages: [message],
      status: "idle",
      activeTaskId: null,
      lastError: null,
      updatedAt: nowIso(),
    });
  };

  const sendQuestion = (
    question: string,
    onSessionAdopted?: (sessionId: string) => void,
  ): string | null => {
    if (!userId || !key || !question.trim()) return null;

    const current = getCoachSession(userId, key);
    if (current.status === "processing") return null;

    // A draft thread has no real ChatSession row yet — don't send it to the
    // backend as a sessionId, let the server auto-create one.
    const outgoingSessionId = isDraftSessionKey(key) ? undefined : key;

    const taskId = safeUuid();
    const userMessage: AiChatMessage = {
      id: Date.now(),
      from: "user",
      text: question.trim(),
      time: "Now",
    };
    const placeholderMessage: AiChatMessage = {
      id: `ai-${taskId}`,
      from: "ai",
      text: "AI đang trả lời...",
      time: "Now",
    };
    const nextTask: PendingAiTask = upsertTask(userId, {
      id: taskId,
      kind: "chat-ask",
      title: "AI đang trả lời câu hỏi",
      status: "PROCESSING",
      link: "/client/ai-coach",
      conversationId: null,
      error: null,
    });

    setCoachSession(userId, key, {
      messages: [...current.messages, userMessage, placeholderMessage],
      status: "processing",
      activeTaskId: taskId,
      lastError: null,
      updatedAt: nowIso(),
    });

    const bucketKey = coachKey(userId, key);
    const requestToken = safeUuid();
    coachRequests.set(bucketKey, {
      token: requestToken,
      cancel: () => {
        const active = coachRequests.get(bucketKey);
        if (active?.token === requestToken) {
          coachRequests.delete(bucketKey);
        }
      },
    });

    const applyIfCurrent = (
      updater: (session: AiCoachSessionState) => AiCoachSessionState,
    ) => {
      const active = coachRequests.get(bucketKey);
      if (!active || active.token !== requestToken) return;
      const latest = getCoachSession(userId, key);
      setCoachSession(userId, key, updater(latest));
    };

    const updateTaskState = (
      status: PendingAiTaskStatus,
      error?: string | null,
      patch: Partial<PendingAiTask> = {},
    ) => {
      updateTask(userId, taskId, {
        ...patch,
        status,
        error: error ?? null,
      });
    };

    // If this thread just got its first server-assigned sessionId, migrate
    // the draft bucket's state into the real bucket and let the page know so
    // it can update the URL/active-session state in the same tick.
    const adoptSessionIfNeeded = (newSessionId: string | undefined) => {
      if (!newSessionId || !isDraftSessionKey(key) || newSessionId === key) {
        return;
      }
      const finalState = getCoachSession(userId, key);
      setCoachSession(userId, newSessionId, finalState);
      deleteCoachSession(userId, key);
      onSessionAdopted?.(newSessionId);
    };

    let isFirstToken = true;

    const streamAvailable =
      typeof window !== "undefined" && "ReadableStream" in window;
    if (!streamAvailable) {
      void coachService
        .chat(question.trim(), outgoingSessionId)
        .then((result) => {
          const replyText =
            result?.answer ||
            "Sorry, I could not get a response. Please try again.";
          const evidenceUsed = Array.isArray(result?.evidenceUsed)
            ? (result.evidenceUsed as CoachEvidenceItem[])
            : [];
          applyIfCurrent((sessionState) => {
            const nextMessages = sessionState.messages.map((message) =>
              message.id === placeholderMessage.id
                ? { ...message, text: replyText, evidenceUsed }
                : message,
            );
            return {
              ...sessionState,
              messages: nextMessages,
              status: "completed",
              activeTaskId: null,
              lastError: null,
              updatedAt: nowIso(),
            };
          });
          updateTaskState("COMPLETED", null, {
            conversationId:
              typeof result?.conversationId === "string"
                ? result.conversationId
                : null,
          });
          adoptSessionIfNeeded(
            typeof result?.sessionId === "string"
              ? result.sessionId
              : undefined,
          );
        })
        .catch(() => {
          const errorText = "AI trả lời thất bại, vui lòng thử lại.";
          applyIfCurrent((sessionState) => ({
            ...sessionState,
            messages: sessionState.messages.map((message) =>
              message.id === placeholderMessage.id
                ? { ...message, text: `⚠️ ${errorText}` }
                : message,
            ),
            status: "failed",
            activeTaskId: null,
            lastError: errorText,
            updatedAt: nowIso(),
          }));
          updateTaskState("FAILED", errorText);
        })
        .finally(() => {
          coachRequests.delete(bucketKey);
        });

      return taskId;
    }

    const cancelStream = coachService.chatStream(
      question.trim(),
      {
        onStatus: (status) => {
          // Real tokens have already started streaming in — a late status event
          // (e.g. the client-side 10s "slow model" notice) must not clobber the
          // answer text that's already visible.
          if (!isFirstToken) return;
          applyIfCurrent((sessionState) => ({
            ...sessionState,
            messages: sessionState.messages.map((message) =>
              message.id === placeholderMessage.id
                ? { ...message, text: status }
                : message,
            ),
            updatedAt: nowIso(),
          }));
        },
        onToken: (token) => {
          applyIfCurrent((sessionState) => {
            return {
              ...sessionState,
              messages: sessionState.messages.map((message) => {
                if (message.id !== placeholderMessage.id) return message;
                if (isFirstToken) {
                  isFirstToken = false;
                  return { ...message, text: token };
                }
                return { ...message, text: `${message.text}${token}` };
              }),
              updatedAt: nowIso(),
            };
          });
        },
        onDone: (payload: CoachStreamDonePayload) => {
          const evidenceUsed = Array.isArray(payload.evidenceUsed)
            ? payload.evidenceUsed
            : [];
          applyIfCurrent((sessionState) => ({
            ...sessionState,
            messages: sessionState.messages.map((message) =>
              message.id === placeholderMessage.id
                ? { ...message, evidenceUsed }
                : message,
            ),
            status: "completed",
            activeTaskId: null,
            lastError: null,
            updatedAt: nowIso(),
          }));
          updateTaskState("COMPLETED", null, {
            conversationId:
              typeof payload.conversationId === "string"
                ? payload.conversationId
                : null,
          });
          coachRequests.delete(bucketKey);
          adoptSessionIfNeeded(payload.sessionId);
        },
        onError: (message) => {
          const errorText = message || "AI trả lời thất bại, vui lòng thử lại.";
          applyIfCurrent((sessionState) => ({
            ...sessionState,
            messages: sessionState.messages.map((item) =>
              item.id === placeholderMessage.id
                ? { ...item, text: `⚠️ ${errorText}` }
                : item,
            ),
            status: "failed",
            activeTaskId: null,
            lastError: errorText,
            updatedAt: nowIso(),
          }));
          updateTaskState("FAILED", errorText);
          coachRequests.delete(bucketKey);
        },
      },
      outgoingSessionId,
    );

    coachRequests.set(bucketKey, {
      token: requestToken,
      cancel: cancelStream,
    });

    return nextTask.id;
  };

  /** Cancels any in-flight request and drops this thread's local cache
   * (memory + localStorage) — e.g. after the thread has been archived. */
  const resetSession = (): void => {
    if (!userId || !key) return;
    const bucketKey = coachKey(userId, key);
    coachRequests.get(bucketKey)?.cancel?.();
    coachRequests.delete(bucketKey);
    deleteCoachSession(userId, key);
    emit();
  };

  return {
    session,
    setInitialMessage,
    sendQuestion,
    resetSession,
  };
}

export function enqueuePlanTask(
  userId: string,
  input: {
    jobId: string;
    planId: string;
    type: "generate" | "adjust";
    status: PendingAiTaskStatus;
    goal: string;
    daysPerWeek: number;
    durationWeeks: number;
  },
): PendingAiTask {
  return upsertTask(userId, {
    id: input.jobId,
    kind: input.type === "generate" ? "plan-generate" : "plan-adjust",
    title: input.type === "generate" ? "Tạo AI Plan" : "Điều chỉnh AI Plan",
    status: input.status,
    link: "/client/plans",
    jobId: input.jobId,
    planId: input.planId,
    goal: input.goal,
    daysPerWeek: input.daysPerWeek,
    durationWeeks: input.durationWeeks,
    error: null,
  });
}

export function acknowledgeTask(userId: string, taskId: string): void {
  removeTask(userId, taskId);
}
