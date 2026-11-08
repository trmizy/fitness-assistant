/**
 * heldMoneyModel.ts
 * Pure functions for periodic held money review (A39, A40).
 */
import type { D65bSummary } from "./moneyExceptionTypes";

/**
 * P2-FIX-1: Filter proposals candidate for held money exit reference.
 * Only proposals belonging to the reviewed session and not REJECTED can be referenced.
 */
export function exitRefCandidates(
  proposals: D65bSummary[] | null | undefined,
  sessionId: string,
): D65bSummary[] {
  if (!proposals || !sessionId) return [];
  return proposals.filter(
    (p) => p.sessionId === sessionId && p.status !== "REJECTED",
  );
}

/**
 * The session's held money was already paid out by an EXECUTED D65-B proposal, but the review row stays open until the
 * next timers sweep (every ~60 s) closes it. Show that instead of offering a decision on a review about to close.
 */
export function heldAlreadyResolved(proposals: D65bSummary[] | null | undefined, sessionId: string): boolean {
  if (!proposals || !sessionId) return false;
  return proposals.some((p) => p.sessionId === sessionId && p.status === "EXECUTED");
}

export const HELD_RESOLVED_NOTE = "Đề xuất xử lý của buổi này đã thực thi. Kỳ rà soát sẽ tự đóng trong khoảng 1 phút; bấm Tải lại để cập nhật.";

export const HELD_MONEY_DECISION_LABEL: Record<string, string> = {
  KEEP_HOLDING: "Giữ tiếp (chưa có hướng xử lý)",
  EXIT_STARTED: "Đã mở hướng xử lý",
};

