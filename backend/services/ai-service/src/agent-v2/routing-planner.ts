/**
 * Gymini V2 (EXPERIMENTAL) — intent-aware routing plan. M4 "intent-v1", hardened in M5.1 as "intent-v1.1"
 * (deterministic, no model call). The M5 version is kept frozen in __tests__/m5-benchmark/baseline-intent-v1.ts.
 *
 * M5.1 model (from the M5 error analysis: context words pulled agents in, synonyms were missed, compound asks lost):
 *   1. CLAUSES: the folded question is split into clauses; a clause is a REQUEST (question word, advice frame "nên / có
 *      cần", imperative "xem giúp / kiểm tra / cho tôi biết", clause-final "không / chưa", "?") or CONTEXT (a statement:
 *      the user's own report). A short marker-less item right after a request continues an enumeration (REQUEST).
 *   2. TERMS: one lexicon row per (need, owner agent) concept. Inside a clause, a term after a framing word ("trước /
 *      sau / khi / để / vì / theo …", clause-initial "đang / muốn / nếu … thì") is BACKGROUND, not an ask.
 *   3. ASKED needs: the first un-framed term of each REQUEST clause. Only an asked need makes its owner REQUIRED;
 *      the primary need is the earliest asked one. No ask but domain terms (a bare statement, "hai cái có liên quan
 *      không?") → the context terms are the ask.
 *   4. SUPPORT: a free slot goes to the strongest background agent only when the user's OWN data from it is needed —
 *      a self-report (statement / framed observation), or a schedule anchored to a day ("hôm nay", a follow-up "vậy").
 *      A bare mention ("trước buổi tập nên ăn gì") never adds an agent.
 *   5. Top `maxAgents` (asked first, in order; then support). Everything required but not run is DEFERRED with its needs
 *      (MAX_AGENTS), or SATISFIED_FROM_SESSION for a support-only agent whose facts are fresh in the session.
 * M7-P4 "intent-v1.2" — the two known defects of v1.1 (found after heldout v2 was scored), fixed without new rules:
 *   KD-1 "mọi người" (everyone) and "mỏi người" (sore body) both fold to "moi nguoi". foldForRouting() keeps the
 *        difference when the question carries diacritics ("mọi" → a neutral token before folding); for unaccented text
 *        "moi nguoi" is AMBIGUOUS and counts as soreness only with a state marker (toi / bi / hoi / rat / dang … before,
 *        qua / lam / ghe … after) — an ambiguous spelling is never treated as a symptom on its own.
 *   KD-2 "hay" = "often" (Tôi hay bị mệt) was read as "or" by the alternative-question rule. "hay / hoặc (là)" now
 *        joins two options only when it stands right before the second option, is not preceded by a subject / habit
 *        word and is not followed by "bị / được …" (the frequency construction).
 * Shopping questions ("có nên mua …") are out of scope. The planner only NAMES agents; it never grants tools, budgets or
 * identity, and the supervisor re-validates everything. Execution ORDER is applied by the supervisor after selection.
 */
import type { AgentId, DecisionInput, DecisionProvider, SupervisorDecision } from "./multi-agent-contracts";
import { foldVi } from "../llm/speech_act";

export type IntentNeed =
  | "TODAY_TRAINING" | "PROGRAM_ADJUSTMENT" | "EXERCISE_INFO" | "TRAINING_MENTION"
  | "NUTRITION_INTAKE" | "NUTRITION_TARGET" | "NUTRITION_FOOD"
  | "RECOVERY_FATIGUE" | "RECOVERY_REST" | "RECOVERY_SLEEP" | "RECOVERY_MODALITY" | "RECOVERY_LOAD" | "RECOVERY_HISTORY"
  | "PROGRESS_STRENGTH" | "PROGRESS_BODY" | "PROGRESS_GOAL" | "PROGRESS_GENERAL" | "PROGRESS_FORECAST";

export interface IntentRule {
  need: IntentNeed;
  agentId: AgentId;
  /** Folded text. */
  pattern: RegExp;
  /** Strength as background evidence (support ranking). */
  weight: number;
  /** As background, only counts when anchored to the user's day / conversation (generic training words, exercise names). */
  anchoredOnly?: boolean;
  /** An entity (exercise name, bare training word): the ask only when the clause has no other concept. */
  entity?: boolean;
  /** A personal observation (fatigue, sleep, logged history, strength / body change): background evidence even inside the ask. */
  observation?: boolean;
}

export interface IntentCandidate {
  need: IntentNeed; agentId: AgentId; weight: number;
  /** True when this need was ASKED (kept name from M4). */
  inRequestClause: boolean;
  position: number;
  /** M5.1: REQUEST = asked; CONTEXT = background / user statement. */
  role?: "REQUEST" | "CONTEXT";
}

export interface RoutingPlan {
  strategy: string;
  intents: IntentCandidate[];
  primaryNeed: IntentNeed | null;
  relevance: Partial<Record<AgentId, number>>;
  selectionReasons: Partial<Record<AgentId, string[]>>;
  selected: AgentId[];
  deferred: Array<{ agentId: AgentId; needs: IntentNeed[]; reason: "MAX_AGENTS" | "SATISFIED_FROM_SESSION" }>;
  coverage: "FULL" | "PARTIAL" | "NONE";
  uncertainty: "LOW" | "MEDIUM" | "HIGH";
}

/** First-person marker (folded). */
const FIRST_PERSON = /\b(toi|minh|em|tui)\b/;

// ── lexicon: one row per concept (adding a synonym = editing one row) ─────────────────────────────────────────────────
const DAY = "hom nay|ngay mai|toi nay|sang nay|chieu nay|tuan nay|tuan toi|tuan sau|thu (?:hai|ba|tu|nam|sau|bay)|chu nhat";
export const INTENT_RULES: readonly IntentRule[] = Object.freeze([
  // training
  { need: "TODAY_TRAINING", agentId: "training", weight: 1.5, anchoredOnly: true, pattern: new RegExp(`\\b(lich tap|buoi tap|lich|buoi \\w+)\\b.{0,12}\\b(${DAY})\\b|\\b(${DAY}|mai)\\b.{0,15}\\b(tap|buoi|lich)\\b|\\bbuoi (mai|toi nay|tiep theo|toi)\\b|\\bco (buoi|lich)( tap)?\\b|\\btap (gi|bai gi|bai nao|nhu the nao|the nao|ra sao)\\b`) },
  { need: "PROGRAM_ADJUSTMENT", agentId: "training", weight: 1.5, pattern: /\b(doi|thay|thay doi|dieu chinh|sua|chinh|sap xep lai|giam|tang|bot|them)\b.{0,20}\b(lich tap|lich|chuong trinh|cach tap|giao an|bai tap|bai|buoi|cuong do|so buoi|muc ta|cardio)\b|\b(giao an|chuong trinh tap|chuong trinh|cach tap|lich tap|split|full body|tan suat|so buoi)\b|\b(may|bao nhieu) (buoi|ngay)\b.{0,15}\b(tuan|tap)\b|\b(giam|tang|bot) khoi luong( tap)?\b|\b(len phong|tap bu|tap lai|muc ta|test max)\b/ },
  { need: "EXERCISE_INFO", agentId: "training", weight: 1, anchoredOnly: true, pattern: /\b(bai tap|bai (nao|gi|khac)|nhom co|co (xo|nguc|vai|dui|mong|bung|tay)|ky thuat|khoi dong|tap (bung|chan|nguc|lung|vai|tay|mong))\b/ },
  { need: "EXERCISE_INFO", agentId: "training", weight: 1, anchoredOnly: true, entity: true, pattern: /\b(romanian deadlift|squat|deadlift|bench( press)?|leg press|hip thrust|overhead press|plank|pull ?up|push ?up|lunge|cardio|chay bo|may keo cap|ta don)\b/ },
  { need: "TRAINING_MENTION", agentId: "training", weight: 1, anchoredOnly: true, entity: true, pattern: /\b(?<!tai )(?<!luong )tap\b(?! trung)|\b(buoi|gym|phong tap|di tap)\b/ },
  // nutrition ("giáo án" → "giao an" and "an toàn / an tâm" are not eating; "uống oải / uống cơ" are fatigue typos)
  { need: "NUTRITION_INTAKE", agentId: "nutrition", weight: 1.5, pattern: /\b(?<!giao )an\b(?! (toan|tam|ninh)\b)|\buong\b(?! (oai|co)\b)|\b(dinh duong|an uong|bua (an|phu|sang|trua|toi)|thuc don|che do an|an kieng|eat clean|nhin an|bo sung)\b/ },
  { need: "NUTRITION_TARGET", agentId: "nutrition", weight: 1.5, pattern: /\b(calo|kcal|macro|protein|dam|carb|tinh bot|chat beo)\b/ },
  { need: "NUTRITION_FOOD", agentId: "nutrition", weight: 1.5, pattern: /\b(whey|creatine|qua trung|trung (ga|luoc|chien|op)|uc ga|thit|ca hoi|com|rau|mon( an)?|thuc pham|vitamin|thieu chat)\b/ },
  // recovery ("mỏi / nhức" only with a body part: "mới / mọi" fold to "moi")
  { need: "RECOVERY_FATIGUE", observation: true, agentId: "recovery", weight: 2, pattern: /\b(met|met moi|qua met|kiet suc|ra roi|ue oai|uong oai|duoi suc|(qua|hoi|bi|thay|rat) duoi|uong co|nhuc (moi|co|dau|chan|vai|lung)|(chan|co|vai|lung|nguoi|bap chan|bap tay) (con |hoi |bi )?(nhuc|moi|e am)|dau moi|moi (lung|vai|chan|co|nguoi|bap)|e am|cang co|chuot rut|doms|qua suc|qua tai|tap qua (suc|tai|nhieu))\b/ },
  { need: "RECOVERY_REST", agentId: "recovery", weight: 2, pattern: /\b(nghi ngoi|ngay nghi|nghi (hoan toan|bao lau|may ngay|giua|them|hay|mot tuan|1 tuan|bu)|(co nen|nen|can|co can) nghi|deload|giam tai|tuan giam)\b|\bnghi\b(?= (khong|di|chua)\b)/ },
  { need: "RECOVERY_SLEEP", observation: true, agentId: "recovery", weight: 1.5, pattern: /\b(thieu ngu|mat ngu|giac ngu|ngu (it|kem|khong du|du|bao nhieu|trua|them|bu|co \d+|\d+))\b/ },
  { need: "RECOVERY_MODALITY", agentId: "recovery", weight: 1, pattern: /\b(hoi phuc|phuc hoi|hoi suc|hoi (nhanh|cham|lai)|cham hoi|foam roller|massage|gian co|keo gian)\b/ },
  { need: "RECOVERY_LOAD", agentId: "recovery", weight: 2, pattern: /\b(tai tap|khoi luong tap|khoi luong (gan day|tuan nay|tuan qua)|tap don|tap lien tuc)\b/ },
  // lazy, and never across "hôm nay" ("vì hôm qua chạy dài nên hôm nay tập gì" = history + today's ask)
  { need: "RECOVERY_HISTORY", observation: true, agentId: "recovery", weight: 1.5, pattern: /\btap\b(?:(?!hom nay).){0,25}?\bhom qua\b|\bhom qua\b(?:(?!hom nay).){0,25}?\b(tap|chay)\b|\b(da tap|buoi hom qua)\b/ },
  // progress ("lành mạnh hơn" is not strength)
  { need: "PROGRESS_STRENGTH", observation: true, agentId: "progress", weight: 2, pattern: /\b(suc manh|suc day|suc keo|1 ?rm|e1rm|(?<!lanh )manh hon|yeu di|plateau)\b|\b(squat|bench( press)?|deadlift)\b.{0,15}\b(khong len|dung yen|chung( lai)?|tang|giam|di xuong)\b/ },
  { need: "PROGRESS_BODY", observation: true, agentId: "progress", weight: 2, pattern: /\b(can nang|body fat|mo co the|ti le mo|ty le mo|mo bung|vong (eo|bung|mong)|inbody|so do|giam duoc|tang duoc|len can|giam can cham|(nang|can) bao nhieu|xuong (duoc )?(may |bao nhieu )?(ky|ki|kg|can)|can( nang)? (dung|chung|giam deu|giam cham|(khong|chua|van khong) (giam|xuong|doi|len|nhuc nhich|thay doi))|(khong|chua|van khong) (giam|xuong|len) can|mo (khong|chua) (xuong|giam)|co the\b.{0,12}\b(thay doi|bien doi|tien trien))\b/ },
  { need: "PROGRESS_GOAL", agentId: "progress", weight: 1.5, pattern: /\b(cach muc tieu|dat muc tieu|toi muc tieu|cham muc tieu|kip muc tieu|muc tieu can nang|can nang muc tieu|dung (huong|lo trinh|ke hoach|tien do))\b/ },
  { need: "PROGRESS_GENERAL", agentId: "progress", weight: 2, pattern: /\b(tien bo|tien do|tien trien|ket qua (tap|do|inbody|chu ky)|xu huong|hieu suat|danh gia chu ky|chu ky( tap)? (vua|truoc))\b/ },
  { need: "PROGRESS_FORECAST", agentId: "progress", weight: 2, pattern: /\b(du bao|du kien (nang|giam|tang|dat|can))\b/ },
]);

// ── clause roles ─────────────────────────────────────────────────────────────────────────────────────────────────────
const QUESTION = /\b(gi|nao|the nao|ra sao|bao nhieu|bao lau|bao xa|nhi|co phai|lieu|hay khong|duoc khong|co sao|lam sao|tai sao|vi sao|tang hay giam|giam hay tang|nghi hay|truoc hay sau)\b|\bmay (buoi|ngay|kg|ky|ki|tieng|lan|hiep|set|phut|tuan)\b|\?/;
const ADVICE = /\b(nen|co nen|co can|can (phai|thiet|nghi|an|tap|doi|them|bo sung|uong|tang|giam))\b/;
const IMPERATIVE = /\b(cho (toi|minh|em) (xem|biet)|xem (giup|qua|lai|thu)|kiem tra|goi y|de xuat|phan tich|tinh (giup|xem)|doi giup|chinh giup|giup (toi|minh|em)|muon biet|tong ket|danh gia (giup|tien do|xem))\b/;
const CLAUSE_FINAL_ASK = /\b(khong|chua)( (nhi|a|ha|vay))?\s*[?.!]?\s*$/;
const isRequestClause = (c: string) => QUESTION.test(c) || ADVICE.test(c) || IMPERATIVE.test(c) || CLAUSE_FINAL_ASK.test(c);
/** Framing words: what follows (up to 4 words) is background. "theo dõi" (track) is not framing. */
const FRAMING = /\b(truoc|sau|trong|khi|vi|theo(?! doi)|de|neu)\b/g;
/** A clause-initial topic / condition "… thì" ("đang cut thì", "tập gym thì", "nếu có thì"): everything before "thì" is background. */
const INITIAL_FRAME = /^[^?]*?\bthi\b/;
/** Discourse follow-up ("vậy / thế / thế còn …"): the turn refers to the conversation (the user's own session). */
const FOLLOW_UP = /^\s*(vay|the|the con|vay thi|a khong|a)\b/;
const TIME_ANCHOR = new RegExp(`\\b(${DAY}|hom qua|dao nay|gan day|hien tai|bay gio|lich)\\b`);
const PURCHASE = /\bmua\b/;
const ALPHA: readonly AgentId[] = ["nutrition", "progress", "recovery", "training"];
/** Supporting-evidence preference per primary owner (tie-break only). */
const SUPPORT_PREF: Readonly<Record<AgentId, readonly AgentId[]>> = Object.freeze({
  training: ["recovery", "progress", "nutrition"],
  nutrition: ["training", "recovery", "progress"],
  recovery: ["training", "progress", "nutrition"],
  progress: ["recovery", "training", "nutrition"],
});

interface Term { rule: IntentRule; start: number; end: number; clause: number; framed: boolean }
interface Clause { start: number; end: number; text: string; request: boolean; purchase: boolean }

function clausesOf(folded: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  for (const m of folded.matchAll(/[,.;!?:]|\b(va|nhung|ma|roi)\b/g)) {
    const end = m.index! + m[0].length;
    if (folded.slice(start, end).trim()) out.push({ start, end, text: folded.slice(start, end), request: false, purchase: false });
    start = end;
  }
  if (folded.slice(start).trim()) out.push({ start, end: folded.length, text: folded.slice(start), request: false, purchase: false });
  let seenRequest = false;
  for (const c of out) {
    c.purchase = PURCHASE.test(c.text);
    c.request = isRequestClause(c.text) || (seenRequest && c.text.trim().split(/\s+/).length <= 6);
    seenRequest ||= c.request;
  }
  return out;
}

/** Longest match wins on overlap (e.g. "squat đứng yên" (progress) over "squat" (training)). */
/** Matched per clause (a term never spans two clauses); the longest match wins on overlap ("squat đứng yên" over "squat"). */
function termsOf(clauses: Clause[], rules: readonly IntentRule[], available: readonly AgentId[]): Term[] {
  const out: Term[] = [];
  clauses.forEach((c, ci) => {
    const raw: Array<{ rule: IntentRule; start: number; end: number }> = [];
    for (const rule of rules) {
      if (!available.includes(rule.agentId)) continue;
      for (const m of c.text.matchAll(new RegExp(rule.pattern.source, "g"))) if (m[0].length) raw.push({ rule, start: m.index!, end: m.index! + m[0].length });
    }
    raw.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept: typeof raw = [];
    for (const t of raw) if (!kept.some((k) => t.start < k.end && k.start < t.end)) kept.push(t);
    for (const t of kept.sort((a, b) => a.start - b.start)) out.push({ rule: t.rule, start: c.start + t.start, end: c.start + t.end, clause: ci, framed: isFramed(c, t.start) });
  });
  return out;
}

function isFramed(c: Clause, offset: number): boolean {
  const init = INITIAL_FRAME.exec(c.text);
  if (init && offset < init.index + init[0].length) return true;
  for (const m of c.text.matchAll(FRAMING)) {
    if (m.index! >= offset) break;
    const between = c.text.slice(m.index! + m[0].length, offset);
    if (/\b(thi|nen|co|can)\b/.test(between) || QUESTION.test(between)) continue;
    if (between.trim().split(/\s+/).filter(Boolean).length <= 4) return true;
  }
  return false;
}

// ── M7-P4 lexical disambiguation (KD-1 / KD-2) ───────────────────────────────────────────────────────────────────────
/** "mọi" (every / everyone, dot below) — written with its diacritic it can never be "mỏi" (sore). */
const MOI_EVERY = /(?<!\p{L})mọi(?!\p{L})/giu;
const HAS_DIACRITIC = /[À-ɏḀ-ỿ̀-ͯ]/u;
/** Unaccented "moi nguoi" is soreness only with a state marker around it; otherwise it is read as "everyone". */
const MOI_NGUOI = /\bmoi nguoi\b/g;
const SORE_BEFORE = /\b(toi|minh|em|tui|bi|hoi|rat|dang|thay|cu|van|con)\s+$/;
const SORE_AFTER = /^\s+(qua|lam|ghe|vl|that|het|ra roi|khong chiu)\b/;
const NEUTRAL_EVERY = "tatca";

/** Fold for routing: like foldVi, but "mọi" (everyone) never becomes "moi" (= "mỏi", sore) when diacritics are present. */
export function foldForRouting(question: string): string {
  const nfc = String(question ?? "").normalize("NFC");
  if (!HAS_DIACRITIC.test(nfc)) return disambiguateUnaccented(foldVi(nfc));
  return foldVi(nfc.replace(MOI_EVERY, NEUTRAL_EVERY));
}
/** For text without diacritics (typed unaccented, or folded by the caller): an ambiguous "moi nguoi" is not a symptom. */
function disambiguateUnaccented(folded: string): string {
  return folded.replace(MOI_NGUOI, (m: string, off: number) =>
    (SORE_BEFORE.test(folded.slice(Math.max(0, off - 16), off)) || SORE_AFTER.test(folded.slice(off + m.length, off + m.length + 16)) ? m : `${NEUTRAL_EVERY} nguoi`));
}

/**
 * KD-2: does the gap between two terms join them as alternatives ("A hay B", "A hay giảm B", "A hoặc là B")? Only when the
 * conjunction is at most two words before option B (its verb: "hay đổi thực đơn"), is not preceded by a subject / habit
 * word ("tôi hay …", "người ta hay …") and is not followed by the frequency construction ("hay bị …", "hay được …").
 */
const ALT_GAP = /^\s*(?:\S+\s+)?(?:(\S+)\s+)?(hay|hoac)(?:\s+la)?((?:\s+\S+){0,2})\s*$/;
const HABIT_BEFORE = /^(toi|minh|em|tui|ban|anh|chi|ta|ho|nguoi|tatca|thuong|cu|rat|kha|van|de|it|cung|lai)$/;
const HABIT_AFTER = /^(bi|duoc|phai|quen)$/;
export function isAlternativeGap(gap: string, optionB: string): boolean {
  const m = ALT_GAP.exec(gap);
  if (!m) return false;
  if (m[1] && HABIT_BEFORE.test(m[1])) return false;
  const next = (m[3].trim() || optionB.trimStart()).split(/\s+/)[0] ?? "";
  return !HABIT_AFTER.test(next);
}

export interface PlanOptions {
  maxAgents: number;
  /** M4 per-agent domain signals. Not used for selection since M5.1 (a domain word alone never selects an agent); kept for the provider signature. */
  domainSignals?: Readonly<Partial<Record<AgentId, RegExp>>>;
  /** Agents whose facts are FRESH in the session: a support-only role is satisfied without running them. */
  satisfiedFromSession?: ReadonlySet<AgentId>;
  rules?: readonly IntentRule[];
  /** M7-P4: the original (accented) question — lets KD-1 tell "mọi người" from "mỏi người". */
  question?: string;
}

export function planRouting(foldedInput: string, available: readonly AgentId[], opts: PlanOptions): RoutingPlan {
  const rules = opts.rules ?? INTENT_RULES;
  // M7-P4: the raw question (when the caller has it) keeps diacritics for KD-1; folded-only input gets the ambiguity rule
  const folded = typeof opts.question === "string" ? foldForRouting(opts.question) : disambiguateUnaccented(foldedInput);
  const clauses = clausesOf(folded);
  const terms = termsOf(clauses, rules, available).filter((t) => !clauses[t.clause].purchase);

  // ASKED: the first un-framed term of each request clause; an entity (exercise name, bare "tập/buổi") is the ask only
  // when nothing else in the clause is ("1RM bench bao nhiêu" asks about the 1RM, "squat cần chú ý gì" about squat)
  const askedIdx = new Set<number>();
  clauses.forEach((c, ci) => {
    if (!c.request) return;
    const free = terms.map((t, i) => ({ t, i })).filter(({ t }) => t.clause === ci && !t.framed);
    const pick = free.find(({ t }) => !t.rule.entity) ?? free[0];
    if (!pick) return;
    askedIdx.add(pick.i);
    // an alternative question asks every option ("đổi lịch tập hay giảm ăn?")
    let last = pick.t;
    for (const x of free) {
      if (x.t.start <= last.start || x.t.rule.entity) continue;
      if (isAlternativeGap(folded.slice(last.end, x.t.start), folded.slice(x.t.start))) { askedIdx.add(x.i); last = x.t; }
    }
  });
  let fallback = false;
  if (!askedIdx.size && terms.length) {
    // a bare statement / "are the two related?" → the domain terms themselves are the ask (strongest first)
    fallback = true;
    const byAgent = new Map<AgentId, number>();
    terms.forEach((t, i) => { const j = byAgent.get(t.rule.agentId); if (j === undefined || terms[j].rule.weight < t.rule.weight) byAgent.set(t.rule.agentId, i); });
    const best = [...byAgent.values()].sort((a, b) => terms[b].rule.weight - terms[a].rule.weight || a - b);
    // a statement asks about its strongest concept; an explicit question with only background terms asks about all of them
    const hasQuestion = clauses.some((c) => c.request);
    for (const i of hasQuestion ? best : best.slice(0, 1)) askedIdx.add(i);
  }
  const intents: IntentCandidate[] = terms.map((t, i) => ({ need: t.rule.need, agentId: t.rule.agentId, weight: t.rule.weight, inRequestClause: askedIdx.has(i), position: t.start, role: askedIdx.has(i) ? "REQUEST" : "CONTEXT" }));

  const asked: AgentId[] = [];
  for (const c of [...intents].filter((x) => x.role === "REQUEST").sort((a, b) => (fallback ? b.weight - a.weight : 0) || a.position - b.position)) if (!asked.includes(c.agentId)) asked.push(c.agentId);
  const primary = asked.length ? intents.filter((x) => x.role === "REQUEST" && x.agentId === asked[0]).sort((a, b) => a.position - b.position)[0] : null;

  // SUPPORT: background agents whose OWN-data evidence the ask needs
  const personal = FIRST_PERSON.test(folded) || TIME_ANCHOR.test(folded) || FOLLOW_UP.test(folded);
  const anchored = TIME_ANCHOR.test(folded) || FOLLOW_UP.test(folded);
  const supportWeight: Partial<Record<AgentId, number>> = {};
  intents.forEach((c, i) => {
    if (c.role !== "CONTEXT" || asked.includes(c.agentId)) return;
    const t = terms[i];
    const selfReport = !clauses[t.clause].request || t.framed;
    const qualifies = t.rule.anchoredOnly ? anchored : (selfReport || (personal && !!t.rule.observation));
    if (qualifies && t.rule.weight >= 1) supportWeight[c.agentId] = Math.max(supportWeight[c.agentId] ?? 0, t.rule.weight);
  });
  const pref = primary ? SUPPORT_PREF[primary.agentId] : [];
  const rank = (a: AgentId) => { const i = pref.indexOf(a); return i < 0 ? 99 : i; };
  const supports = (Object.keys(supportWeight) as AgentId[]).sort((a, b) => supportWeight[b]! - supportWeight[a]! || rank(a) - rank(b) || ALPHA.indexOf(a) - ALPHA.indexOf(b));
  const sessionDeferred = supports.filter((a) => opts.satisfiedFromSession?.has(a));
  const liveSupports = supports.filter((a) => !sessionDeferred.includes(a));

  const max = Math.max(0, opts.maxAgents);
  const selected = [...asked, ...liveSupports].slice(0, max);
  const relevance: Partial<Record<AgentId, number>> = {};
  const reasons: Partial<Record<AgentId, string[]>> = {};
  asked.forEach((a, i) => { relevance[a] = 10 - i; (reasons[a] ??= []).push(i === 0 ? `primary:${primary!.need}` : "asked"); });
  liveSupports.forEach((a) => { relevance[a] = supportWeight[a]!; (reasons[a] ??= []).push(`supports:${primary?.need ?? "none"}`); });
  const needsOf = (a: AgentId) => [...new Set(intents.filter((c) => c.agentId === a).map((c) => c.need))];
  const deferred: RoutingPlan["deferred"] = [
    ...[...asked, ...liveSupports].filter((a) => !selected.includes(a)).map((a) => ({ agentId: a, needs: needsOf(a), reason: "MAX_AGENTS" as const })),
    ...sessionDeferred.map((a) => ({ agentId: a, needs: needsOf(a), reason: "SATISFIED_FROM_SESSION" as const })),
  ];

  let uncertainty: RoutingPlan["uncertainty"] = !selected.length ? "HIGH" : fallback ? "MEDIUM" : "LOW";
  // the last support slot was a tie on evidence strength, settled by preference
  const lastSupport = selected.find((a) => !asked.includes(a));
  if (lastSupport && liveSupports.some((b) => b !== lastSupport && supportWeight[b] === supportWeight[lastSupport]) && uncertainty === "LOW") uncertainty = "MEDIUM";
  const coverage: RoutingPlan["coverage"] = !selected.length ? "NONE" : deferred.some((d) => d.reason === "MAX_AGENTS") ? "PARTIAL" : "FULL";
  return { strategy: "intent-v1.2", intents, primaryNeed: primary?.need ?? null, relevance, selectionReasons: reasons, selected, deferred, coverage, uncertainty };
}

/** DecisionProvider over planRouting. The plan travels with the decision (codes only) for the supervisor and its trace. */
export function createIntentDecisionProvider(opts: Omit<PlanOptions, "satisfiedFromSession">): DecisionProvider & { plan(input: DecisionInput, satisfied?: ReadonlySet<AgentId>): RoutingPlan } {
  const plan = (input: DecisionInput, satisfied?: ReadonlySet<AgentId>) => planRouting(input.folded, input.available, { ...opts, satisfiedFromSession: satisfied, ...(typeof input.question === "string" ? { question: input.question } : {}) });
  return {
    name: "intent-v1.2",
    plan,
    decide(input: DecisionInput): SupervisorDecision {
      const p = plan(input, input.satisfiedFromSession);
      return { strategy: p.strategy, agents: p.selected, reasonCodes: p.primaryNeed ? [`primary:${p.primaryNeed}`] : ["no_primary_need"], plan: p };
    },
  };
}

/** True when the question is about the user (first person) — used by callers that need it. */
export const isFirstPerson = (folded: string) => FIRST_PERSON.test(folded);
