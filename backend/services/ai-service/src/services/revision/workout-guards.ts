/**
 * Phase 3 Batch 4 — honest handling of an exercise-swap phrase ("Đổi Bulgarian Split Squat luôn")
 * when there is NO pending CREATE_WORKOUT_PLAN draft for it to apply to. Confirmed again this batch
 * (same finding as Batch 3 §10): no fitness-service endpoint exists for "replace exercise X in my
 * ACTIVE program going forward." Falling through to generic chat here is exactly the documented
 * hallucination risk (claims a change that never happened) — this guard answers truthfully instead.
 *
 * Only fires when ALL of: an explicit swap/exclusion cue is literally in the message, a known
 * exercise-revision keyword is extracted, no pending workout draft exists, AND the message carries no
 * ordinal list-reference ("người thứ hai" — that combination almost always means a PT/PROGRAM
 * candidate exclusion, a different domain entirely, not a named exercise).
 *
 * Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 1): the ordinal-reference
 * check alone was not enough. extractExerciseRevisionKeyword's own carrier-word stripping was only
 * ever designed to be safe when a pending draft already grounds the call (its sole original call
 * site, tryReviseWorkoutPlanDraft) — called standalone on arbitrary free text, it returns a non-null
 * leftover string for nearly any sufficiently long message (e.g. "Tạo cho tôi lịch giảm mỡ 4 buổi, tôi
 * tập ở nhà." strips down to a non-empty residue, because its carrier list treats "nhà" the same as
 * the colloquial particle "nha"/"nhé" after diacritic-stripping) — which made this guard wrongly
 * intercept a plain workout-CREATION request with no exclusion/swap cue at all. Fixed by also
 * requiring SWAP_CUE_RE: an explicit đổi/thay/không muốn/tránh/kiêng/loại bỏ/bỏ token in the raw text.
 *
 * extractExerciseRevisionKeyword is injected (not imported) because fitness-agent.service.ts is this
 * module's own caller — a direct import back would be circular, same constraint/fix as every other
 * Batch 3/4 revision module in this directory.
 */
import type { AgentBlock } from "../fitness-agent.service";
import { resolveOrdinalReference } from "./reference-resolution";
import { normalizeAgentText } from "../fitness-agent-intent";

const LIMITATION_ANSWER = "Mình chưa thể thay đổi vĩnh viễn bài tập trong chương trình đang áp dụng qua chat — bạn có thể dùng tính năng đổi bài ngay trong buổi tập, hoặc nói \"tạo lịch tập mới\" để mình đề xuất một lịch thay thế.";
const SWAP_CUE_RE = /\b(doi|thay the|thay|khong (?:co|muon|dung|the|thich|can)|tranh|kieng|loai bo|bo)\b/;

export function tryExplainUnsupportedPermanentSwap(
  question: string, hasPendingWorkoutDraft: boolean, extractExerciseRevisionKeyword: (text: string) => string | null,
): { answer: string; blocks: AgentBlock[] } | null {
  if (hasPendingWorkoutDraft) return null;
  if (!SWAP_CUE_RE.test(normalizeAgentText(question))) return null;
  if (resolveOrdinalReference(question) !== null) return null;
  if (!extractExerciseRevisionKeyword(question)) return null;
  return { answer: LIMITATION_ANSWER, blocks: [] };
}
