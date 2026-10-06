import { normalizeAgentText, parseFitnessAgentIntent } from "../../services/fitness-agent-intent";
import { interpretDeterministic } from "../interpreter";
import { detectReferences, detectWhy, hasCorrectionCue, isQuestionForm } from "../signals";

/**
 * GLOBAL semantic routing: what does this turn WANT, inside or outside a workflow?
 *
 *   READ_STATE            "Tôi đang có PT chưa?"          → Enterprise Data read (authoritative), never a search
 *   RECOMMEND             "Tôi nên cut hay bulk?"         → deterministic recommendation from the user's own data
 *   WRITE_ACTION          "Thuê PT này", "Đổi mục tiêu…"  → only ever a PROPOSAL behind the existing confirmation
 *   START_WORKFLOW        "Tìm PT cho tôi"                → the existing workflow
 *   KNOWLEDGE_QA          "RIR là gì?"                    → RAG chat
 *   SLOT_ANSWER / CORRECTION / CANCEL / SWITCH_WORKFLOW     (only while a workflow waits for a slot)
 *   REFERENCE / EXPLAIN_AND_PROPOSE / NEGATE_ACTION / MULTI
 *
 * This module only CLASSIFIES. It executes nothing and selects no tool; the policy layer maps a route to an allow-listed action.
 */

export type GlobalRoute =
  | "READ_STATE" | "RECOMMEND" | "WRITE_ACTION" | "START_WORKFLOW" | "KNOWLEDGE_QA" | "SLOT_ANSWER" | "CORRECTION"
  | "CANCEL" | "SWITCH_WORKFLOW" | "REFERENCE" | "EXPLAIN_AND_PROPOSE" | "NEGATE_ACTION" | "MULTI" | "UNKNOWN";

export type ReadTopic = "ROADMAP_STATUS" | "PT_STATUS" | "CONTRACT_STATUS" | "PROGRAM_STATUS" | "SCHEDULE" | "NUTRITION_TARGET" | "NUTRITION_PROGRAM" | "GOAL" | "PROFILE_FACT";
export type RecommendTopic = "GOAL" | "TARGET_WEIGHT" | "SESSIONS" | "MEALS" | "HIRE_PT" | "PT" | "PROGRAM";

export interface GlobalRouteResult {
  route: GlobalRoute;
  topic?: ReadTopic | RecommendTopic | "GOAL_CHANGE";
  workflow?: string;
  /** for MULTI: the per-clause routes, in order */
  multi?: GlobalRoute[];
  /** for MULTI: the full per-clause classification (topics/workflows), in order */
  parts?: GlobalRouteResult[];
  /** a workflow is waiting and this turn is NOT an answer to it (answer, then leave the workflow untouched) */
  interrupts?: boolean;
  confidence: number;
  reason: string;
}

export interface GlobalContext {
  active?: { wf: string; slot?: string | null } | null;
  proposal?: boolean;
  /** a workout/nutrition/roadmap DRAFT is pending confirmation for this session (it owns revision/confirmation turns, like a waiting workflow) */
  draft?: boolean;
}

const WF_BY_KIND: Record<string, string> = {
  CREATE_PLAN_BUNDLE: "CREATE_ROADMAP", CREATE_WORKOUT_PLAN: "CREATE_WORKOUT_PLAN", CREATE_NUTRITION_PLAN: "CREATE_NUTRITION_PLAN",
  PT: "FIND_PT", PROGRAM: "FIND_TRAINING_PROGRAM",
};

// ── vocabulary (diacritic-stripped) ──
const N = {
  pt: /\b(pt|hlv|huan luyen vien|personal trainer|\btrainer\b|\bcoach\b)\b/,
  contract: /hop dong/,
  program: /(chuong trinh( tap)?|giao an|\bprogram\b)/,
  schedule: /(lich tap|buoi tap|tap gi\b|lich (hom nay|tuan|ngay mai)|workout (today|hom nay))/,
  nutritionTarget: /(calo|calories|kcal|macro|protein|carb|chat dam|dinh duong)/,
  // "gói ăn/gói dinh dưỡng" names the saved PROGRAM (which meal plan you're on), not the calorie/macro TARGET — kept
  // distinct from nutritionTarget below even though both can mention "dinh dưỡng".
  menu: /(thuc don|bua an|ke hoach an|goi (an|dinh duong))/,
  goal: /(muc tieu(?! can nang)|\bgoal\b)/,
  targetWeight: /(can nang muc tieu|muc tieu can nang|target weight)/,
  // height family: "chiều cao" is the compound noun, but people just as often ask with the bare adjective ("tôi cao bao
  // nhiêu?", "cao mấy mét?") the same way "nặng bao nhiêu?" already covers weight below — this mirrors that shape rather
  // than matching every occurrence of "cao" (which is also the unrelated verb "nâng cao" = improve).
  weightFact: /(can nang|chieu cao|bao nhieu kg|nang bao nhieu|cao\s*(bao nhieu|may\s*(m\b|met|cm)|the nao)|bao nhieu\s*(m\b|met|cm)\b|\bheight\b|\btuoi\b)/,
  roadmap: /(lo trinh)/,
};
const PERSONAL = /(cua (toi|minh|t)\b|\b(toi|minh|t|em)\s+(dang|co|nen|da|con|muon|duoc|can|khong)\b|cho (toi|minh|t)\b|voi (toi|minh|t)\b|hop voi|phu hop voi|\bmy\b|\bi\b|\bmine\b|\btoi\b|\bminh\b)/;
const STATE_CUE = /(chua(\s+(nhi|nha|nhe|a|vay|ta|the|day|khong|nao))?\s*[?.!]*\s*$|dang (co|theo|tap|an|follow|dung|hoat dong)|hien (tai|gio|nay)|la ai|ten gi|trang thai|den dau|dau roi|hom nay|ngay mai|tuan nay|current|hien co|theo (chuong trinh|thuc don|ke hoach)|follow|duoc an|the nao)/;
const REC_CUE = /(\bnen\b|co nen|co can|hop (voi|ly)|phu hop|de xuat|goi y|tu van|nao (hop|phu hop|tot)|cut hay bulk|bulk hay cut|cut or bulk|should i|recommend|khong biet nen)/;
const COMMAND_START = /^\s*(tao|lap|len|tim|xay|dung|soan|xep|thiet ke|build|create|find|cho (toi|minh|t)\s+(mot|xem|thuc|lich|lo|chuong)|toi muon (co|tao|tim)|giup (toi|minh|t)\s+(tao|lap|xay|dung|soan|xep|thiet ke|tim)|goi y)\b/;
const WRITE_START = /^\s*(thue|doi|cap nhat|chuyen|luu|chon|dat|huy|xoa|dong y thue|ap dung|hire|change|update|save)\b/;
// "chọn"/"đặt"/"thuê"/"hire" are only a concrete WRITE when they act on something already SPECIFIC — an ordinal/demonstrative
// referent ("này/đó/kia/vừa rồi/đầu tiên/thứ 2"), or a proposal this session already offered. Without one, "chọn/thuê giúp tôi
// một PT phù hợp" is asking the assistant to FIND/RECOMMEND one, not to write anything yet — same principle the legacy intent
// parser already applies to "thuê" (fitness-agent-intent.ts's `select` regex). The other verbs here (lưu/hủy/đổi/cập nhật/…)
// act on "the current thing" (a draft, the profile) and never needed this distinction.
const WRITE_VERB_NEEDS_REFERENT = /^\s*(thue|chon|dat|hire)\b/;
const REFERENT = /\b(nay|do|kia|vua roi|luc nay|dau tien|thu\s*(nhat|hai|ba|bon|\d+)|so\s*\d+|first)\b/;
const NEGATION_ACTION = /(khong (muon|can|luu|thue|tim)|dung (doi|tim|thue|luu)|chua muon|khong can .* nua)/;
const CANCEL_ONLY = /^\s*(thoi|huy( di)?|khong can nua|dung lai|bo qua( di)?|cancel|stop|thoi khong)\s*[.!]*\s*$/;
const READ_VERB = /^\s*(check|xem|kiem tra|cho (toi|minh|t) (xem|biet)|show|tra cuu)\b|(cho (toi|minh|t) (xem|biet)|check giup|xem giup)/;
const EXPLAIN_VERB = /^\s*(giai thich|explain|noi (ve|cho)|cho (toi|minh) biet (ve|la))\b/;
const GOAL_WORDS = /(giam mo|tang co|duy tri|hieu suat|giam can|tang can|cut|bulk)/;
const KNOWLEDGE_Q = /(la gi\b|khac (gi|nhau)|nhu the nao|the nao\b|\bntn\b|what is|tai sao|vi sao|co (hai|an toan|tot|beo|nen|the|phai|can) .*(khong|ko)\b|bao nhieu set|bao lau|cach (tinh|lam)|tinh the nao)/;
const SLOT_TOKENS = /(khong gioi han|khong quan trong|bat ky|t[2-7]\b|thu\s*[2-7]|chu nhat|\d+\s*(tr|trieu|k|buoi|bua|phut|kg|ky|ngay))/;

const has = (re: RegExp, s: string) => re.test(s);

function readTopic(s: string): ReadTopic | null {
  if (has(N.contract, s) && has(N.pt, s) || has(N.contract, s)) return "CONTRACT_STATUS";
  if (has(N.pt, s)) return "PT_STATUS";
  if (has(N.targetWeight, s)) return "PROFILE_FACT";
  if (has(N.menu, s) && !/(calo|calories|kcal|macro|protein|carb|chat dam)/.test(s)) return "NUTRITION_PROGRAM";
  if (has(N.nutritionTarget, s)) return "NUTRITION_TARGET";
  if (has(N.program, s) || /tap (may|bao nhieu) buoi/.test(s)) return "PROGRAM_STATUS";
  if (has(N.schedule, s)) return "SCHEDULE";
  if (has(N.goal, s) || /\bcut\b.*\bbulk\b|\bbulk\b.*\bcut\b/.test(s)) return "GOAL";
  if (has(N.weightFact, s)) return "PROFILE_FACT";
  return null;
}

function recommendTopic(s: string): RecommendTopic | null {
  if (has(N.pt, s) && /(nen|can|co nen|co can).*(thue|dung|tim)|thue.*(khong|ko)\b/.test(s)) return "HIRE_PT";
  if (has(N.pt, s) && /(nao|hop|phu hop)/.test(s)) return "PT";
  if (has(N.program, s)) return "PROGRAM";
  if (has(N.targetWeight, s) || /can nang.*(muc tieu|bao nhieu)|dat can nang/.test(s) && /muc tieu/.test(s)) return "TARGET_WEIGHT";
  if (/(bao nhieu|may) buoi|buoi.*(tuan|thang)/.test(s)) return "SESSIONS";
  if (/(bao nhieu|may) bua|bua.*(ngay|hop ly)/.test(s)) return "MEALS";
  // "siết (cân)" (tighten up) / "tăng (cân)" are the everyday way to say cut/bulk without ever using those loanwords or
  // the noun "mục tiêu" — same family as GOAL_WORDS below, just the bare recommendation-direction verbs.
  if (/(cut|bulk|\bsiet\b|\btang\b.*\bhay\b|\bhay\b.*\btang\b)/.test(s) || has(N.goal, s)) return "GOAL";
  return null;
}

function workflowOf(text: string): string | undefined {
  const intent = parseFitnessAgentIntent(text);
  const byIntent = WF_BY_KIND[intent.kind as string];
  if (byIntent) return byIntent;
  const s = normalizeAgentText(text);
  const hasCreationVerb = /(^|\s)(tao|lap|len|xay|dung|soan|xep|thiet ke|build|create|make|cho (toi|minh|t) (mot)?|toi muon (co|tao)|giup (toi|minh|t)\s+(tao|lap|xay|dung|soan|xep|thiet ke)|goi y)\b/.test(s);
  if (!hasCreationVerb) return undefined;
  if (/lo trinh|roadmap/.test(s)) return "CREATE_ROADMAP";
  if (/(thuc don|meal plan|bua an|lich an)/.test(s)) return "CREATE_NUTRITION_PLAN";
  if (/(lich tap|plan tap|workout plan|training plan|lich workout)/.test(s)) return "CREATE_WORKOUT_PLAN";
  return undefined;
}

/** classify ONE clause (no multi-intent splitting, no workflow context) */
function classifyClause(text: string, sIn: string, ctx: GlobalContext): GlobalRouteResult {
  let s = sIn;
  s = s.replace(/^\s*(neu (chua|khong|chua co) thi|neu vay thi|vay thi)\s+/, "");
  // politeness / discourse fillers at the start do not change what is being asked ("hãy lập cho tôi…", "vui lòng tìm…", "ok đổi…")
  s = s.replace(/^\s*((hay|vui long|xin|nho|lam on|ok|oke|okay)\s+)+/, "");
  // "khoan chuyện PT đã, …", "trước khi X, …", "nhân tiện,"/"tiện thể," — a discourse aside that SETS ASIDE an earlier topic
  // before the real question. Without stripping it, a mention of "PT"/"chuong trinh" inside the aside contaminates topic
  // detection for the actual question that follows (found live: "Khoan chuyện PT đã, hiện tôi ăn mục tiêu bao nhiêu calo?"
  // was read as a PT question, not the calorie question it actually asks).
  s = s.replace(/^\s*(khoan\s+[^,]{0,40}\bda\b\s*,\s*|truoc khi\s+[^,]{0,60},\s*|(nhan tien|tien the)\s*,?\s*)/, "");
  const question = isQuestionForm(s, text) || KNOWLEDGE_Q.test(s) || /\b(chua|nao|khong|gi|ai|bao nhieu|the nao|may|dau|ntn)\b\s*[?.!]*\s*$/.test(s);
  const personal = has(PERSONAL, s);
  const wf = workflowOf(text);

  // negation of an ACTION ("không muốn thuê PT") — unless the same sentence asks to SEE state
  if (has(NEGATION_ACTION, s) && !/(cho (toi|minh|t) (biet|xem)|chi cho)/.test(s) && !has(STATE_CUE, s) && !/(hop dong|dang (co|theo))/.test(s.replace(/chua muon thue/, ""))) {
    return { route: "NEGATE_ACTION", confidence: 0.85, reason: "negated action" };
  }

  // explicit imperative business action → PROPOSE only
  const needsReferent = has(WRITE_VERB_NEEDS_REFERENT, s) && !has(REFERENT, s) && !ctx.proposal;
  if (has(WRITE_START, s) && !question && !needsReferent) {
    const goalChange = has(GOAL_WORDS, s) || has(N.goal, s) || has(N.targetWeight, s);
    return { route: "WRITE_ACTION", topic: goalChange ? "GOAL_CHANGE" : undefined, confidence: 0.85, reason: "imperative write verb" };
  }

  // READ vs FIND: "Tôi đang có PT chưa?" is a read even though it contains "PT"
  const topic = readTopic(s);
  const stateAsk = has(STATE_CUE, s) && (personal || has(/(pt|hop dong|chuong trinh|lich tap|thuc don|muc tieu|calo|macro)/, s));
  const command = has(COMMAND_START, s);
  // a "hiện tại của tôi là cut hay bulk?" question is a READ unless the user asks what they SHOULD do
  const asksShould = /(\bnen\b|co nen|co can|hop (voi|ly)|phu hop|de xuat|goi y|tu van|should|recommend|khong biet nen)/.test(s);
  const recCue = has(REC_CUE, s) && !(stateAsk && !asksShould);

  if (has(EXPLAIN_VERB, s)) return { route: "KNOWLEDGE_QA", confidence: 0.75, reason: "explain request" };
  if (has(READ_VERB, s) && topic) return { route: "READ_STATE", topic, confidence: 0.8, reason: "read verb on a business topic" };
  if (command && wf && (!stateAsk || !question)) return { route: "START_WORKFLOW", workflow: wf, confidence: 0.85, reason: "creation/search command" };
  if (command && !wf && !recCue && !stateAsk) return { route: "START_WORKFLOW", confidence: 0.5, reason: "command without known workflow" };

  if (recCue && (personal || recommendTopic(s)) && !(stateAsk && !recCue)) {
    const t = recommendTopic(s);
    if (t) return { route: "RECOMMEND", topic: t, workflow: t === "PT" ? "FIND_PT" : t === "PROGRAM" ? "FIND_TRAINING_PROGRAM" : undefined, confidence: 0.8, reason: "personalized recommendation cue" };
  }

  // a STATEMENT that hands over values ("Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, hiện tại 80kg, mục tiêu 30kg.") is information, never a read request
  if (!question && interpretDeterministic(text, {}).entities.some((e) => !e.negated && e.explicit)) return { route: "UNKNOWN", confidence: 0.4, reason: "statement carrying values" };
  if (has(N.roadmap, s) && !command && (stateAsk || question) && !recCue) return { route: "READ_STATE", topic: "ROADMAP_STATUS", confidence: 0.8, reason: "roadmap status question (existing roadmap-status intent)" };
  if (topic && stateAsk) return { route: "READ_STATE", topic, confidence: 0.85, reason: "state question about the user's own data" };
  const possessive = /(cua (toi|minh|t)\b|\b(toi|minh|t) (dang|co|duoc)\b)/.test(s);
  if (topic && personal && question && (possessive || !KNOWLEDGE_Q.test(s))) return { route: "READ_STATE", topic, confidence: 0.7, reason: "personal question on a business topic" };
  // "có hợp với tình trạng của tôi không?" — a personalised fit question with no topic of its own (inherits the previous clause's)
  if (recCue && personal && question) return { route: "RECOMMEND", confidence: 0.55, reason: "personalised fit question" };

  if (question && (KNOWLEDGE_Q.test(s) || !personal)) return { route: "KNOWLEDGE_QA", confidence: 0.75, reason: "impersonal knowledge question" };
  if (topic && question) return { route: "READ_STATE", topic, confidence: 0.55, reason: "weak read" };
  if (wf && !question) return { route: "START_WORKFLOW", workflow: wf, confidence: 0.6, reason: "workflow noun" };
  return { route: "UNKNOWN", confidence: 0.3, reason: "no confident signal" };
}

/** split a multi-part turn ("… rồi …", "… và …?", "…? Nếu chưa thì …") into clauses */
function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[?!.])\s+|,?\s+(?:rồi|roi|sau đó|sau do|nếu chưa thì|neu chua thi|và|va)\s+/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 3);
}

export function classifyGlobal(text: string, ctx: GlobalContext = {}): GlobalRouteResult {
  const s = normalizeAgentText(text);
  const interp = interpretDeterministic(text, { expectedSlot: ctx.active?.slot ?? null });
  const asserted = interp.entities.filter((e) => !e.negated);

  // ── inside a waiting workflow: is this an answer to it, a correction, a cancel, a switch — or something else entirely? ──
  if (ctx.active) {
    if (CANCEL_ONLY.test(s)) return { route: "CANCEL", confidence: 0.95, reason: "bare cancel" };
    const wf = workflowOf(text);
    if (wf && wf !== ctx.active.wf && (has(COMMAND_START, s) || /(thoi|khoan).*(tim|tao|lap|len)|(tim|tao|lap|len).*(truoc|da)/.test(s))) {
      return { route: "SWITCH_WORKFLOW", workflow: wf, confidence: 0.85, reason: "explicit switch to another workflow" };
    }
    const stateAsk = has(STATE_CUE, s) && (has(PERSONAL, s) || /(pt|hop dong|chuong trinh|lich tap|thuc don|muc tieu|calo|macro|can nang)/.test(s));
    const asksSomething = isQuestionForm(s, text) || /\?\s*$/.test(text.trim());
    if (hasCorrectionCue(s) && (asserted.length > 0 || interp.goalSignals.length > 0 || interp.corrections.length > 0)) {
      return { route: "CORRECTION", confidence: 0.85, reason: "correction cue with a new value" };
    }
    if (ctx.proposal && detectReferences(s).length > 0 && asserted.length === 0) return { route: "REFERENCE", confidence: 0.85, reason: "reference to the outstanding proposal" };
    if (!stateAsk && !asksSomething && (asserted.length > 0 || SLOT_TOKENS.test(s) || interp.references.length > 0 || detectReferences(s).length > 0)) {
      return { route: "SLOT_ANSWER", confidence: 0.85, reason: "value for the waiting slot" };
    }
    const g = classifyClause(text, s, ctx);
    if (["READ_STATE", "KNOWLEDGE_QA", "RECOMMEND"].includes(g.route) && !(g.route === "RECOMMEND" && /(tap|buoi|bua|ngan sach|muc tieu can nang)/.test(s) && ctx.active.slot)) {
      return { ...g, interrupts: true, reason: `interruption: ${g.reason}` };
    }
    if (g.route === "RECOMMEND") return { ...g, reason: `recommendation for the waiting slot: ${g.reason}` };
    if (asserted.length > 0) return { route: "SLOT_ANSWER", confidence: 0.6, reason: "entities present" };
    return { ...g, reason: `in-workflow fallthrough: ${g.reason}` };
  }

  // ── a revision cue for a PENDING DRAFT ("sai rồi, phải là 5 buổi" while a workout preview awaits confirmation) ──
  // A pending draft is conversation state exactly like a waiting workflow: it owns corrections/revisions. CI-V2 only recognises the
  // shape and hands the turn back to the draft's own revision router — it must never be answered as a standalone recommendation.
  if (ctx.draft && hasCorrectionCue(s) && (asserted.length > 0 || interp.goalSignals.length > 0 || interp.corrections.length > 0)) {
    return { route: "CORRECTION", confidence: 0.8, reason: "correction cue with a new value for the pending draft" };
  }

  // ── references to something the assistant offered ──
  const refs = detectReferences(s);
  const hardWrite = /^\s*(thue|luu|chon|hire|save|ap dung)\b/.test(s);
  if (ctx.proposal && refs.length > 0 && !hardWrite) return { route: "REFERENCE", confidence: 0.8, reason: "reference to a proposal" };
  if (ctx.proposal && /^\s*(ok|oke|dong y|duoc)\b/.test(s) && /(de xuat|goi y|nhu vay|the)/.test(s)) return { route: "REFERENCE", confidence: 0.75, reason: "accepting the proposal" };
  if (ctx.proposal && has(/(khong luu|dung luu|khong can luu)/, s)) return { route: "NEGATE_ACTION", confidence: 0.85, reason: "declining a proposal" };

  // ── explanation + action in one turn ──
  if (detectWhy(s) && /(doi|cap nhat|chuyen) .*(muc tieu|giup)|doi (luon|giup)/.test(s)) {
    return { route: "EXPLAIN_AND_PROPOSE", topic: "GOAL_CHANGE", confidence: 0.85, reason: "why + change request" };
  }

  // ── multi-intent ──
  const clauses = splitClauses(text);
  if (clauses.length >= 2) {
    const parts = clauses.map((c) => classifyClause(c, normalizeAgentText(c), ctx)).filter((p) => p.route !== "UNKNOWN");
    for (let i = 1; i < parts.length; i += 1) if (parts[i].route === "RECOMMEND" && !parts[i].topic && parts[i - 1].topic) parts[i] = { ...parts[i], topic: parts[i - 1].topic as never };
    const distinct = parts.map((p) => `${p.route}:${p.topic ?? p.workflow ?? ""}`);
    if (parts.length >= 2 && new Set(distinct).size >= 2) return { route: "MULTI", multi: parts.map((p) => p.route), parts, confidence: 0.7, reason: "several distinct requests" };
  }

  return classifyClause(text, s, ctx);
}
