import { foldVi } from "../llm/speech_act";

/**
 * AI Coach bridge — capability PREFLIGHT (M9.4-T2). Pure, no I/O, no model.
 *
 * M9.4-T1 showed two question families the bridge sent to V2 although V2 cannot answer them from the user's data:
 *   N04  "Hôm qua tôi đã ăn những gì?"      — meal / intake LOG history (V2 Nutrition has only target / plan-consistency / food search)
 *   T06  "Tuần này tôi tập mấy buổi rồi?"   — sessions over a PERIOD (the router picks Training, whose tools do not include session history)
 * This module recognises exactly those families so the bridge keeps them on V1 BEFORE V2 starts (never "try V2, then fall back").
 *
 * Design rules (to avoid the broad-keyword trap):
 *  - A match needs SEVERAL independent cues in ONE clause: first person + a past/running period + the activity verb + a count/"what" word
 *    (or an explicit "log / history" noun phrase). Single words such as "ăn", "tập", "hôm qua" never match alone.
 *  - Advice / planning / possibility wording in the SAME clause vetoes the match ("nên", "cần", "có thể", "muốn", "hợp lý", "để", "nếu"…):
 *    "Tôi nên ăn gì trước buổi tập?" and "Tôi tập chân hôm qua, hôm nay nên tập gì?" stay on V2.
 *  - Clauses are judged independently, so a multi-domain question that CONTAINS a history clause ("Tuần này tôi tập mấy buổi và nên ăn gì?")
 *    still goes to V1: V2 is not claimed to cover it.
 *  - "hôm nay" / "tuần sau" are plan periods, not history: "Hôm nay tôi tập gì?" stays on V2 (verified: T01).
 *  - The failure direction is safe: a false positive only keeps a question on V1 (the default engine); a false negative leaves it on V2, where it
 *    ends INSUFFICIENT_DATA / generic — never an unsafe answer. The measured rates are in __tests__/coach-capability-preflight.test.ts.
 *  - This is a DENY-list of capabilities KNOWN to be missing. It is NOT proof that V2 supports everything else.
 */
// "cần"/"cân" and "để"/"đề"/"dễ" fold to the same ASCII, so those words are checked on the UN-folded clause (ADVICE_RAW) and are absent from ADVICE.
const ADVICE = /\b(?:nen|co the|muon|dinh|se|phai|hay|lam sao|nhu the nao|co nen|neu|goi y|ke hoach|thuc don|hop ly|la du|du chua|an toan|tot nhat|tot hon|loi khuyen|khuyen)\b/;
const ADVICE_RAW = /(?<!\p{L})(?:cần|để|có thể|muốn|định|sẽ|phải|hãy|nên|nếu)(?!\p{L})/u;
const ME = String.raw`(?:toi|minh|em|tui|mik)`;
const PAST_OR_RUNNING = String.raw`(?:hom qua|tuan nay|tuan truoc|tuan roi|thang nay|thang truoc|thang roi|\d+ ngay (?:qua|gan day|truoc)|gan day|vua roi|hom kia|hom truoc|\d+ tuan (?:qua|truoc))`;
const PAST_ONLY = String.raw`(?:hom qua|tuan truoc|tuan roi|thang truoc|thang roi|\d+ ngay (?:qua|truoc)|\d+ tuan (?:qua|truoc)|hom kia|hom truoc)`;
const ATE = String.raw`(?:an|nap|uong|tieu thu|an vao)`;
const COUNT_OR_WHAT = String.raw`(?:may buoi|bao nhieu buoi|bao nhieu lan|bao nhieu ngay|may lan|may ngay|gi|nhung gi|nhung mon gi|mon gi|bai nao|nhung bai nao|nhom co nao|bao lau)`;

// meal / intake log
const MEAL_LOG: RegExp[] = [
  new RegExp(String.raw`\b(?:nhat ky|lich su|log|history|so ghi)\b[^.!?]{0,25}\b(?:an uong|bua an|dinh duong|calo|kcal|meal|food|nutrition)\b`),
  new RegExp(String.raw`\b(?:an uong|bua an|dinh duong|meal|food|nutrition)\b[^.!?]{0,15}\b(?:nhat ky|lich su|log|history)\b`),
  new RegExp(String.raw`\b${ME}\b[^.!?]{0,14}\b(?:da|vua|moi)\s+${ATE}\b`),
  new RegExp(String.raw`\b${PAST_OR_RUNNING}\b[^.!?]{0,22}\b${ME}\b[^.!?]{0,12}\b${ATE}\b`),
  new RegExp(String.raw`\b${ME}\b[^.!?]{0,12}\b${ATE}\b[^.!?]{0,30}\b${PAST_OR_RUNNING}\b`),
  new RegExp(String.raw`\b${ME}\b[^.!?]{0,12}\b${ATE}\b[^.!?]{0,10}\bbao nhieu\b[^.!?]{0,12}\b(?:calo|kcal|protein|dam|carb|chat beo)\b`),
  new RegExp(String.raw`\b${PAST_ONLY}\b[^.!?]{0,6}\b${ATE}\b\s+(?:gi|nhung gi|nhung mon gi|mon gi)\b`),
];
// sessions over a past / running period: needs the period, the first person, the activity verb AND a count/"what" word in one clause
const WORKOUT_HISTORY: RegExp[] = [
  new RegExp(String.raw`\b(?:lich su|nhat ky|so ghi)\b[^.!?]{0,15}\b(?:tap|tap luyen|workout|buoi tap)\b`),
  new RegExp(String.raw`\b(?:tap luyen|buoi tap|workout)\b[^.!?]{0,12}\b(?:lich su|nhat ky)\b`),
  new RegExp(String.raw`\b${PAST_OR_RUNNING}\b[^.!?]{0,22}\b${ME}\b[^.!?]{0,14}\btap\b[^.!?]{0,22}\b${COUNT_OR_WHAT}\b`),
  new RegExp(String.raw`\b${ME}\b[^.!?]{0,14}\b(?:da|vua|moi)?\s*tap\b[^.!?]{0,18}\b${COUNT_OR_WHAT}\b[^.!?]{0,25}\b${PAST_OR_RUNNING}\b`),
  new RegExp(String.raw`\b${ME}\b[^.!?]{0,10}\b(?:da|vua|moi)\s+tap\b[^.!?]{0,22}\b${COUNT_OR_WHAT}\b`),
];

const CLAUSE_SPLIT = /[,;:]|(?<!\p{L})(?:và|rồi|còn|cũng như|đồng thời)(?!\p{L})/u;
/** A clause counts only when it has NO advice / planning wording of its own (judged on the un-folded AND the folded clause). */
const anyClause = (q: string, patterns: RegExp[]): boolean => {
  const raw = String(q ?? "").toLowerCase().normalize("NFC");
  return raw.split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean).some((rc) => {
    if (ADVICE_RAW.test(rc)) return false;
    const f = foldVi(rc);
    return !ADVICE.test(f) && patterns.some((re) => re.test(f));
  });
};

/** "What did I eat / how much have I eaten" — a question about the user's own intake log. */
export function isMealLogQuestion(question: string): boolean { return anyClause(question, MEAL_LOG); }
/** "How many / which sessions did I do over a period" — a question about the user's own workout history. */
export function isWorkoutHistoryPeriodQuestion(question: string): boolean { return anyClause(question, WORKOUT_HISTORY); }
