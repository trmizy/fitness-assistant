/**
 * Phase 3 Batch 4 — nutrition calorie-target revision.
 *
 * IMPORTANT finding from this batch's own investigation (fitness-agent.service.ts's own
 * `resolveNutritionTarget` doc comment, "M3"): the calorie/macro target is NEVER chosen by this chat
 * layer or by the LLM — it is always either the user's real ACTIVE NutritionGoal or the same
 * deterministic profile-based calculation fitness-service's onboarding already computes. This is an
 * existing, deliberate, already-enforced invariant (not something this batch is free to relax): even
 * the EXISTING nutrition-draft revision path (tryPollOrReviseNutritionPlanDraft) re-resolves the
 * AUTHORITATIVE target fresh on every revision — it never lets free-text override the number.
 *
 * Given that, "Đổi mục tiêu xuống 1900 kcal" has NO safe mechanism to honor literally (rescaling
 * macros for an arbitrary user-chosen number would mean this chat layer inventing a nutrition-science
 * formula, which is exactly what M3 already forbids). This module therefore:
 *   - fully supports the HYPOTHETICAL case ("nếu 1900 thì sao?") — a zero-write comparison against the
 *     real authoritative target, never a proposal;
 *   - for a REAL override request ("đổi xuống 1900 kcal", no "nếu"), answers honestly that chat cannot
 *     set an arbitrary target and explains what actually determines it, and creates NO proposal/action
 *     at all (safer than a fake PENDING action a user could later "confirm" into nothing).
 */
import { normalizeAgentText } from "../fitness-agent-intent";
import type { AgentIdentity } from "../fitness-agent-tools";
import type { AgentBlock } from "../fitness-agent.service";
import type { NutritionTargetDiff } from "./diff";

type NutritionTargetSnapshot = { source: "ACTIVE_GOAL" | "COMPUTED"; calories: number; protein: number; carbs: number; fat: number; goalId?: string };

export interface NutritionRevisionDeps {
  resolveNutritionTarget: (identity: AgentIdentity) => Promise<{ ok: true; target: NutritionTargetSnapshot } | { ok: false; message: string }>;
}

const HYPOTHETICAL_RE = /\b(neu|gia su)\b.*\b(thi sao|the nao|duoc khong|on khong|co cao khong|co thap khong|co on khong)\b|\b(thi sao|the nao)\s*$/;
// The hypothetical number often has no unit attached ("nếu 1900 thì sao?") — captured right after
// "nếu"/"giả sử". A real-change request always needs an explicit unit (KCAL_RE) since "đổi xuống 5"
// alone is not a calorie-change request at all.
const HYPOTHETICAL_NUMBER_RE = /\b(?:neu|gia su)\b\s*(\d{3,5})/;
const KCAL_RE = /\b(\d{3,5})\s*(?:kcal|calo|cal)\b/;
const REAL_CHANGE_CUE_RE = /\b(doi|giam|tang|chuyen)\b.*\b(xuong|len|thanh|ve)\b/;

export async function tryReviseNutritionTarget(
  question: string, identity: AgentIdentity, deps: NutritionRevisionDeps,
): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
  const s = normalizeAgentText(question);
  const isHypothetical = HYPOTHETICAL_RE.test(s);
  const numberMatch = isHypothetical ? (s.match(HYPOTHETICAL_NUMBER_RE) ?? s.match(KCAL_RE)) : s.match(KCAL_RE);
  if (!numberMatch) return null;
  const requested = Number(numberMatch[1]);
  const isRealChange = !isHypothetical && REAL_CHANGE_CUE_RE.test(s);
  if (!isHypothetical && !isRealChange) return null;

  const resolved = await deps.resolveNutritionTarget(identity);
  if (!resolved.ok) return { answer: resolved.message, blocks: [] };

  if (isHypothetical) {
    const diff: NutritionTargetDiff = { caloriesFrom: resolved.target.calories, caloriesTo: requested, macrosRescaled: false };
    const delta = diff.caloriesTo - diff.caloriesFrom;
    const direction = delta < 0 ? "thấp hơn" : delta > 0 ? "cao hơn" : "bằng";
    return {
      answer: `Mục tiêu hiện tại của bạn là ${diff.caloriesFrom} kcal/ngày. ${diff.caloriesTo} kcal sẽ ${direction} mục tiêu hiện tại ${Math.abs(delta)} kcal. Đây chỉ là so sánh — mình chưa đổi gì; nếu bạn muốn áp dụng mức này thật, hãy nói rõ bạn muốn tạo lại thực đơn hoặc cập nhật mục tiêu.`,
      blocks: [],
    };
  }

  // Real change requested — no safe mechanism exists to honor an arbitrary chat-specified number
  // (see module doc comment). Explain truthfully; create nothing.
  return {
    answer: `Mình chưa thể đổi trực tiếp mục tiêu dinh dưỡng sang một số calo tự chọn qua chat — mục tiêu ${resolved.target.calories} kcal hiện tại lấy từ ${resolved.target.source === "ACTIVE_GOAL" ? "mục tiêu dinh dưỡng đang hoạt động" : "hồ sơ của bạn"} để đảm bảo macro luôn nhất quán. Bạn có thể nhờ mình "tạo kế hoạch dinh dưỡng mới" (thực đơn sẽ dùng mục tiêu chuẩn này), hoặc cập nhật mục tiêu dinh dưỡng trong trang Dinh dưỡng nếu muốn một mức khác.`,
    blocks: [],
  };
}
