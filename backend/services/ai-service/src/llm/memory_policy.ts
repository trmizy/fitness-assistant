/**
 * Deterministic long-term-memory write policy — ADV-002
 * (docs/ai-agent-adversarial-findings.md): `remember_user_fact` previously
 * validated only tool-call shape (length/category/authenticated user), with
 * no boundary preventing a mutable enterprise fact (current weight, InBody
 * %, roadmap phase, remaining contract sessions, today's nutrition log)
 * from being written into durable `UserMemory` if the LLM called the tool
 * with one. Per docs/ai-agent-system-target-architecture.md §"Data
 * ownership — never interchangeable": `UserMemory` is for stable
 * preferences only; mutable operational state belongs to the owning
 * business service and must be read fresh every time, never cached as an
 * AI memory. See CLAUDE.md's "Source of Truth" table.
 *
 * This is a pure, deterministic classifier — not an LLM call — matching
 * this codebase's existing "validator should preferentially be
 * deterministic" discipline (also applied in recommendation_narrator.ts).
 *
 * Policy (docs/ai-agent-system-feasibility-audit.md's own worked
 * examples, §5):
 *  - "Tôi thích tập buổi tối" -> long-term memory (stable preference)
 *  - "Tôi hiện nặng 76.2kg" -> enterprise data, NOT memory
 *  - "Chu kỳ tập hiện tại của tôi" -> enterprise data, NOT memory
 *  - "Tôi vừa hỏi về creatine" -> conversation context, NOT memory
 *
 * On ambiguity (neither a recognized mutable-fact marker nor a recognized
 * stable-preference marker), the default is DENY — per this task's own
 * instruction ("For ambiguous facts: prefer DENY / don't persist over
 * polluting durable memory"), a rejected memory write degrades gracefully
 * (the chat response still succeeds; the fact is simply not remembered),
 * whereas an incorrectly-accepted mutable fact silently corrupts future
 * personalization until it happens to be overwritten.
 */

import { classifySpeechAct, type SpeechAct } from "./speech_act";

export type MemoryPolicyDecision = "ALLOW" | "DENY";

export interface MemoryPolicyResult {
  decision: MemoryPolicyDecision;
  reason: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

// Mutable enterprise facts — owned by a business service, re-read fresh
// every time, never cached as durable AI memory. Checked FIRST: a mutable-
// fact marker always wins over a preference marker if both somehow appear
// (e.g. "toi thich tap nhung hom nay da tap roi" — mixed signal — treated
// as a logged-event report, not a stable preference, since acting
// conservatively on ambiguity is the stated policy).
const MUTABLE_ENTERPRISE_FACT_RE = new RegExp(
  [
    // Vietnamese
    "\\bkg\\b", "body fat", "\\binbody\\b", "%\\s*mo\\b", "can nang",
    "\\broadmap\\b", "\\bphase\\b", "chu ky tap", "training cycle",
    "hop dong", "\\bcontract\\b", "buoi con lai", "session con lai",
    "\\bkcal\\b", "bua sang", "bua trua", "bua toi", "calo hom nay",
    "muc tieu dinh duong", "nutritiongoal", "nutrition goal",
    "hien tai.{0,10}(nang|can|dang o)", "hom nay.{0,10}(da tap|da an|da uong)",
    "con lai \\d", "\\d+\\s*buoi",
    // A time-bound report ("Hôm nay tôi không ăn sáng") is a logged event, not a stable preference.
    "\\b(hom nay|hom qua|sang nay|trua nay|toi nay|chieu nay)\\b",
    // English (this classifier is bilingual — the system accepts English
    // input, see e.g. recommendation_narrator.ts's English test coverage)
    "\\blbs?\\b", "\\bpounds?\\b", "\\bweigh(s|ing)?\\b.{0,15}\\b\\d",
    "currently weigh", "\\bsessions?\\s*(left|remaining)\\b",
    "\\bbreakfast\\b", "\\blunch\\b", "\\bdinner\\b", "calories today",
    "today.{0,15}(already (trained|worked out|ate|ran|ran out))",
  ].join("|"),
);

// Stable, durable preferences — the kind of fact that should persist
// across sessions and doesn't change turn-to-turn.
const STABLE_PREFERENCE_RE = new RegExp(
  [
    // Vietnamese
    "khong thich", "\\bthich\\b", "uu tien", "so thich",
    "an chay", "di ung(?! .{0,15}(kg|inbody))",
    // A standing dietary restriction stated as a negation ("Tôi không ăn thịt", "Em không ăn hải sản", "kiêng sữa").
    "\\bkhong (an|uong) (duoc )?(thit|ca|hai san|trung|sua|do ngot|gluten|lactose|tom|cua|bo|heo|ga|rau|hanh|toi|cay)", "\\bkieng\\b", // "dị ứng" (allergy) is stable UNLESS immediately describing a live InBody-adjacent metric
    "phong cach (tap|huan luyen)",
    // "giờ tập" as a TIME SLOT only ("giờ tập của tôi là 6h", "khung giờ tập tối") — the bare "gio tap" also matched "giờ tập
    // bụng được chưa" (giờ = "now") and stored "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa" as a fact (eval B4-37/B4-49).
    "(khung )?gio tap (cua (toi|em|minh)|la|vao|luc|thuong|quen|co dinh)", "khung gio", "thuong tap (vao |luc )?(buoi )?(sang|trua|chieu|toi|dem)",
    // English
    "\\bprefers?\\b", "\\bfavou?rite\\b", "\\bpriorit(y|ize)\\b",
    "\\bvegetarian\\b", "\\bvegan\\b",
    "\\ballerg(y|ic)(?! .{0,15}(kg|inbody))\\b",
    "training style", "workout time", "time slot",
  ].join("|"),
);

export function classifyMemoryFact(fact: string): MemoryPolicyResult {
  const text = normalize(fact);
  // Only something the user ASSERTED about themselves can become a durable fact. A question ("Ăn chay thì có tăng cơ được
  // không"), a hypothetical ("Nếu tôi ăn chay…") or a command is never a fact about the user, whatever keywords it contains
  // (eval 2026-11-11: both memories of persona B were questions). Negations stay statements: "Tôi không ăn thịt".
  const act: SpeechAct = classifySpeechAct(fact);
  if (act !== "STATEMENT") {
    return { decision: "DENY", reason: `not_a_statement:${act.toLowerCase()}` };
  }
  if (MUTABLE_ENTERPRISE_FACT_RE.test(text)) {
    return { decision: "DENY", reason: "mutable_enterprise_fact" };
  }
  if (STABLE_PREFERENCE_RE.test(text)) {
    return { decision: "ALLOW", reason: "stable_preference" };
  }
  return { decision: "DENY", reason: "ambiguous_default_deny" };
}

/** The existing free-text `UserMemory.category` vocabulary (schema.prisma) — used as the memory's DOMAIN. */
export type MemoryDomain = "dietary" | "schedule" | "exercise_preference" | "other";

const DIETARY_RE = /\b(an chay|thuan chay|di ung|khong an|kieng|thich an|khong uong|lactose|gluten|hai san|thit|trung|sua|vegetarian|vegan|allerg\w*|halal)\b/;
const SCHEDULE_RE = /\b(gio tap|khung gio|thuong tap|buoi (sang|trua|chieu|toi)|sang som|toi muon|cuoi tuan|ca dem|workout time|time slot|morning|evening)\b/;
const EXERCISE_RE = /\b(tap|bai|squat|deadlift|bench|cardio|chay bo|yoga|ta|dumbbell|barbell|may|cable|pt|huan luyen|training|exercise)\b/;

export function classifyMemoryDomain(fact: string): MemoryDomain {
  const text = normalize(fact);
  if (DIETARY_RE.test(text)) return "dietary";
  if (SCHEDULE_RE.test(text)) return "schedule";
  if (EXERCISE_RE.test(text)) return "exercise_preference";
  return "other";
}
