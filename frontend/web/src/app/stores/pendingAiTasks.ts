import { useEffect, useSyncExternalStore } from "react";
import {
  planService,
  coachService,
  type CoachEvidenceItem,
  type CoachStreamDonePayload,
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

const taskTimers = new Map<string, ReturnType<typeof setInterval>>();
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

function coachStorageKey(userId: string): string {
  return `${COACH_STORAGE_PREFIX}:${userId}`;
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

function persistCoach(userId: string): void {
  writeJson(coachStorageKey(userId), coachCache.get(userId) ?? null);
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

function getCoachSession(userId?: string): AiCoachSessionState {
  if (!userId) {
    return {
      messages: [],
      status: "idle",
      activeTaskId: null,
      lastError: null,
      updatedAt: nowIso(),
    };
  }

  if (!coachCache.has(userId)) {
    const persisted = readJson<AiCoachSessionState | null>(
      coachStorageKey(userId),
      null,
    );
    coachCache.set(
      userId,
      persisted ?? {
        messages: [],
        status: "idle",
        activeTaskId: null,
        lastError: null,
        updatedAt: nowIso(),
      },
    );
  }

  return (
    coachCache.get(userId) ?? {
      messages: [],
      status: "idle",
      activeTaskId: null,
      lastError: null,
      updatedAt: nowIso(),
    }
  );
}

function setCoachSession(userId: string, session: AiCoachSessionState): void {
  coachCache.set(userId, session);
  persistCoach(userId);
  emit();
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
          error: "Kế hoạch không tồn tại hoặc đã bị xoá.",
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
  coachCache.delete(userId);
  coachRequests.delete(userId);
  if (isBrowser()) {
    localStorage.removeItem(taskStorageKey(userId));
    localStorage.removeItem(coachStorageKey(userId));
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

export function useAiCoachSession(userId?: string) {
  const session = useSyncExternalStore(
    subscribe,
    () => getCoachSession(userId),
    () => ({
      messages: [],
      status: "idle",
      activeTaskId: null,
      lastError: null,
      updatedAt: nowIso(),
    }),
  );

  const setInitialMessage = (message: AiChatMessage): void => {
    if (!userId) return;
    const current = getCoachSession(userId);
    if (current.messages.length > 0) return;
    setCoachSession(userId, {
      ...current,
      messages: [message],
      status: "idle",
      activeTaskId: null,
      lastError: null,
      updatedAt: nowIso(),
    });
  };

  const sendQuestion = (question: string): string | null => {
    if (!userId || !question.trim()) return null;

    const current = getCoachSession(userId);
    if (current.status === "processing") return null;

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

    setCoachSession(userId, {
      messages: [...current.messages, userMessage, placeholderMessage],
      status: "processing",
      activeTaskId: taskId,
      lastError: null,
      updatedAt: nowIso(),
    });

    const requestToken = safeUuid();
    coachRequests.set(userId, {
      token: requestToken,
      cancel: () => {
        const active = coachRequests.get(userId);
        if (active?.token === requestToken) {
          coachRequests.delete(userId);
        }
      },
    });

    const applyIfCurrent = (
      updater: (session: AiCoachSessionState) => AiCoachSessionState,
    ) => {
      const active = coachRequests.get(userId);
      if (!active || active.token !== requestToken) return;
      const latest = getCoachSession(userId);
      setCoachSession(userId, updater(latest));
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

    let isFirstToken = true;

    const streamAvailable =
      typeof window !== "undefined" && "ReadableStream" in window;
    if (!streamAvailable) {
      void coachService
        .chat(question.trim())
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
        })
        .catch(() => {
          const errorText = "AI trả lời thất bại, thử lại.";
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
          coachRequests.delete(userId);
        });

      return taskId;
    }

    const cancelStream = coachService.chatStream(question.trim(), {
      onStatus: (status) => {
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
        coachRequests.delete(userId);
      },
      onError: (message) => {
        const errorText = message || "AI trả lời thất bại, thử lại.";
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
        coachRequests.delete(userId);
      },
    });

    coachRequests.set(userId, {
      token: requestToken,
      cancel: cancelStream,
    });

    return nextTask.id;
  };

  const resetSession = (): void => {
    if (!userId) return;
    const active = coachRequests.get(userId);
    active?.cancel?.();
    coachRequests.delete(userId);
    coachCache.delete(userId);
    if (isBrowser()) {
      localStorage.removeItem(coachStorageKey(userId));
    }
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
