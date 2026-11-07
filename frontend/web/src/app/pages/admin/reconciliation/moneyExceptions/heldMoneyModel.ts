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

export const HELD_MONEY_DECISION_LABEL: Record<string, string> = {
  KEEP_HOLDING: "Giữ tiếp (chưa có hướng xử lý)",
  EXIT_STARTED: "Đã mở hướng xử lý",
};

