/**
 * Durable identity of ONE deliberate chat action (R222-03). Pure logic, no React / network / storage imports, so the
 * rules are unit-testable with node:test like the rest of this frontend's utils.
 *
 * Contract:
 *  - one record (and one `clientRequestId`) is created per deliberate send, and is persisted BEFORE the request leaves;
 *  - the explicit retry of a failed/uncertain send REUSES that record's id and its stored question (the payload cannot
 *    drift between the original and the retry, so the server never sees "same id, different payload" from this client);
 *  - a deliberate new send (even with identical text) creates a NEW record and id;
 *  - records are scoped to the authenticated user: another account can never see or reuse them;
 *  - after a reload an interrupted send is recovered as "uncertain" (we do not know whether the server admitted it) and
 *    is offered for retry with the SAME id, never silently replayed with a new one.
 */
export type ChatRequestStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface ChatRequestRecord {
  id: string; // task id
  userId: string;
  kind?: string;
  status: string;
  clientRequestId?: string | null;
  question?: string | null;
  sessionKey?: string | null;
  uncertain?: boolean;
  error?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export type ChatRequestView =
  | { state: "pending"; label: string; canRetry: false }
  | { state: "completed"; label: string; canRetry: false }
  | { state: "failed"; label: string; canRetry: boolean }
  | { state: "uncertain"; label: string; canRetry: boolean };

/** Fields to persist for a brand-new deliberate action. The id is generated here, exactly once. */
export function newChatRequestFields(userId: string, sessionKey: string, question: string, newId: () => string): Required<Pick<ChatRequestRecord, "clientRequestId" | "question" | "sessionKey">> & { id: string; userId: string } {
  const id = newId();
  return { id, userId, clientRequestId: id, question: question.trim(), sessionKey };
}

const isChat = (r: ChatRequestRecord) => r.kind === "chat-ask";

/** Records visible to this user only. */
export function forUser<T extends ChatRequestRecord>(records: T[], userId: string | undefined): T[] {
  if (!userId) return [];
  return records.filter((r) => r.userId === userId);
}

/**
 * The record an explicit retry should reuse: the newest FAILED chat request of THIS user in THIS thread that still has
 * its id and question. A COMPLETED request is never retryable (it was answered). Returns null when there is none.
 */
export function findRetryable<T extends ChatRequestRecord>(records: T[], userId: string | undefined, sessionKey: string): T | null {
  const candidates = forUser(records, userId)
    .filter((r) => isChat(r) && r.status === "FAILED" && r.sessionKey === sessionKey && !!r.clientRequestId && !!r.question)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return candidates[0] ?? null;
}

/**
 * After a reload / crash: a chat request still PROCESSING with no live request object cannot be completed by anything.
 * It becomes FAILED + uncertain (we do not know whether the server admitted it), keeping its id for a faithful retry.
 */
export function recoverInterrupted<T extends ChatRequestRecord>(records: T[], userId: string | undefined, liveTaskIds: ReadonlySet<string>): T[] {
  if (!userId) return records;
  return records.map((r) =>
    r.userId === userId && isChat(r) && r.status === "PROCESSING" && !liveTaskIds.has(r.id)
      ? { ...r, status: "FAILED", uncertain: true, error: r.error ?? "Yêu cầu bị gián đoạn." }
      : r,
  );
}

/** Truthful, user-facing state for a request. */
export function describeChatRequest(r: ChatRequestRecord): ChatRequestView {
  if (r.status === "PROCESSING" || r.status === "QUEUED") return { state: "pending", label: "AI đang xử lý yêu cầu của bạn…", canRetry: false };
  if (r.status === "COMPLETED") return { state: "completed", label: "Đã hoàn tất.", canRetry: false };
  const canRetry = isChat(r) && !!r.clientRequestId && !!r.question;
  if (r.uncertain) {
    return { state: "uncertain", label: "Chưa rõ yêu cầu đã được xử lý hay chưa. Bấm “Thử lại” để gửi lại đúng yêu cầu này — nếu yêu cầu trước đã được xử lý, bạn sẽ nhận lại đúng kết quả đó và không bị tạo trùng.", canRetry };
  }
  return { state: "failed", label: "AI trả lời thất bại. Bạn có thể bấm “Thử lại” — yêu cầu sẽ không bị tạo trùng.", canRetry };
}
