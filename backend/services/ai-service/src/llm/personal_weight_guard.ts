import { foldVi } from "./speech_act";

/**
 * Deterministic output guard: a model-written sentence that STATES THE USER'S OWN body weight as a number must be backed by the user's own
 * record (M9.4-T2; finding S06 of M9.4-T1: "Cân nặng của bạn hiện là 99 kg" survived both V1 and V2 when no measurement existed).
 *
 * Shared by V1 (orchestrator, after the fidelity guard) and V2 (bounded agent engine, after the agent's own guard) — one rule, two callers.
 * It only REMOVES sentences (never rewrites or invents a value) and appends a neutral notice that carries NO number.
 *
 * What counts as a CLAIM (all of): second-person / "the user's own" owner + the body-weight concept + a figure in kg, stated as a fact:
 *   "Cân nặng của bạn hiện là 99 kg" · "Bạn đang nặng 72 kg" · "Số đo cân nặng gần nhất là 72.4 kg" · "your weight is 70 kg"
 * What is NOT a claim (kept, never touched): questions to the user; conditionals / examples / hypotheticals ("nếu bạn nặng 70 kg",
 * "ví dụ", "giả sử"); generic or third-person statements ("người nặng 70 kg cần khoảng 140 g protein", "1 kg mỡ ≈ 7700 kcal"); targets,
 * ideals and forecasts ("cân nặng mục tiêu là 68 kg", "dự báo"); any sentence without a kg figure; a weight the user stated in this conversation.
 *
 * Evidence is ONLY: figures from the authenticated user's own records (passed in by the caller, with their role and age) and weights the user
 * stated in THIS conversation. Missing data stays missing: no default is ever substituted. A claim is supported when its figure matches:
 *   current claim     → the LATEST measurement or the profile-reported weight (not a previous measurement, not the start weight)
 *   historical claim  → any sourced figure (marker: "trước đó", "lần đo trước", "ban đầu", …)
 *   a figure of the latest measurement older than STALE_AFTER_DAYS may not be stated as current without a dating qualifier (an old measurement is
 *   NOT worthless: stated with its date, or framed as past, it is kept).
 * Tolerance: ±0.05 kg for a decimal figure, ±0.5 kg for a whole number (rounding), nothing else.
 *
 * Source contract (M9.4-T3): a weight the USER stated (kg unit or right after "nặng") is accepted only as "not invented by the model" — user-reported is
 * NOT verified, and the guard does not relabel it. Another user's figure is never evidence (the caller passes only the authenticated user's own data).
 * Known limits (documented, not hidden): conflicting sources (latest measured vs profile-reported differ) → either is accepted as "current", the
 * guard does not arbitrate; a claim phrased in a way no pattern covers is not seen (a pattern list is a backstop, not a proof of absence).
 */
export type WeightRole = "LATEST_MEASURED" | "PREVIOUS_MEASURED" | "PROFILE_REPORTED";
export interface SourcedWeight { kg: number; role: WeightRole; /** age of the measurement in days, when known */ ageDays?: number | null }
export interface PersonalWeightEvidence {
  sourced: readonly SourcedWeight[];
  question: string;
  /** earlier user messages of THIS session only (never memories, never other sessions, never another user) */
  sessionUserMessages?: readonly string[];
}
export interface PersonalWeightResult { answer: string; removed: string[]; reasons: string[] }

export const STALE_AFTER_DAYS = 90;
export const NO_VERIFIED_WEIGHT_NOTICE = "Mình chưa có số cân nặng đã được ghi nhận của bạn cho nội dung này nên không nêu con số cụ thể.";
/** Used when EVERY removed figure existed in the user's record but was old / a previous measurement: "no weight on record" would be untrue then. */
export const STALE_OR_HISTORY_NOTICE = "Số đo cân nặng đã ghi nhận của bạn đã cũ hoặc là số đo trước đó, nên mình không nêu nó như cân nặng hiện tại. Bạn cập nhật số đo mới để mình tư vấn chính xác hơn.";
/** Appended only when a removed sentence carried a safety warning that could not be kept on its own. Carries no number. */
export const GENERIC_SAFETY_REFERRAL = "Nếu bạn đang có vấn đề sức khoẻ hoặc thấy không khoẻ, hãy trao đổi với bác sĩ hoặc chuyên gia y tế.";

const KG = String.raw`(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg|ky|ki|kilo|kilos|kilogram)\b`;
const CLAIMS: RegExp[] = [
  new RegExp(String.raw`\bcan nang\b[^.!?\n]{0,40}?\bcua (?:ban|em|anh|chi)\b[^.!?\n]{0,30}?${KG}`),
  new RegExp(String.raw`\bcan nang\b[^.!?\n]{0,15}?${KG}\s*(?:cua (?:ban|em|anh|chi))`),
  new RegExp(String.raw`\b(?:ban|em|anh|chi)\s+(?:hien tai\s+|hien nay\s+|hien\s+|dang\s+|van\s+|bay gio\s+)*(?:nang|can nang)\s+(?:khoang\s+|gan\s+|xap xi\s+|dang o muc\s+|o muc\s+)?${KG}`),
  new RegExp(String.raw`\b(?:you weigh|your (?:current )?weight is|you are currently)\s+(?:about\s+|around\s+)?${KG}`),
  new RegExp(String.raw`\b(?:so do|lan do|chi so|ket qua do)\b[^.!?\n]{0,40}\bcan nang\b[^.!?\n]{0,25}?${KG}`),
  new RegExp(String.raw`\bcan nang\b[^.!?\n]{0,20}\b(?:hien tai|hien nay|hien|bay gio|gan nhat|moi nhat|do duoc|duoc ghi nhan|da ghi nhan)\b[^.!?\n]{0,20}?${KG}`),
];
const NOT_A_FACT = /\b(?:neu|gia su|gia du|vi du|chang han|tuong tuong|gia dinh|truong hop|tru khi|if|suppose|for example|e\.g|imagine)\b/;
const NOT_CURRENT_WEIGHT = /\b(?:muc tieu|ly tuong|khuyen nghi|trung binh|toi da|toi thieu|mong muon|du kien|du bao|ke hoach|goal|target|ideal|forecast|se (?:dat|giam|tang))\b/;
const HISTORICAL = /\b(?:truoc do|lan do truoc|lan truoc|truoc day|hoi |thang truoc|tuan truoc|luc dau|ban dau|bat dau|da tung|tung nang|lan dau)\b/;
const DATED = /\b(?:cach day|lan do|do ngay|do vao|vao ngay|vao thang|ngay \d|thang \d|da cu|cu hon|trong lan|\d{1,2}[\/-]\d{1,2}|20\d\d)\b/;
// a trajectory ("đi từ 74 kg xuống 72.4 kg"): its start point is a figure of the observed series, not a statement of the CURRENT weight. Trend claims have
// their own guards (V2 progress: trend_without_history, forecast_as_actual …); this guard does not judge them.
const TRAJECTORY = /\b(?:tu|di tu|giam tu|tang tu|from)\s+\d+(?:[.,]\d+)?\s*(?:kg|ky|ki|kilo)?\s*(?:xuong|len|den|toi|to|->)/;
const LINE_PREFIX = /^(\s*(?:[-*•]|\d+[.)])\s+)/;

const num = (s: string) => Number(s.replace(",", "."));
const matches = (n: number, kg: number) => Math.abs(n - kg) <= (Number.isInteger(n) ? 0.5 : 0.05);

// M9.4-T3: a figure the USER stated counts only when it is stated AS A WEIGHT (a number with a kg unit, or right after "nặng"/"cân nặng").
// M9.4-T2 accepted ANY number in the session (an age, a calorie target, a rep count) as "user-stated", so "Bạn đang nặng 25 kg" passed after "Tôi 25 tuổi".
const USER_WEIGHT_UNIT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg|ky|ki|kilo|kilos|kilogram|can)\b/g;
const USER_WEIGHT_WORD = /\b(?:can nang|nang)\s*(?:la\s+|khoang\s+|gan\s+)?(\d{1,3}(?:[.,]\d{1,2})?)\b/g;
const figuresIn = (texts: readonly string[]): number[] => texts.flatMap((t) => {
  const f = foldVi(String(t ?? ""));
  return [...f.matchAll(USER_WEIGHT_UNIT), ...f.matchAll(USER_WEIGHT_WORD)].map((m) => num(m[1]));
});

// M9.4-T3: removing a sentence must not remove a SAFETY warning that shares it ("Cân nặng của bạn là 99 kg, bạn nên đi khám bác sĩ"), and must not
// leave a consequence sentence ("Vì vậy bạn nên giảm 31 kg") hanging on a premise that was just removed.
const SAFETY_CUE = /(?<!\p{L})(?:bác sĩ|bác sỹ|y tế|khám|chuyên gia|nguy hiểm|không an toàn|cảnh báo|cấp cứu|dừng tập|ngừng tập|đau|chóng mặt|ngất|rối loạn ăn uống)(?!\p{L})/u;
const LEAD_CONNECTIVE = /^(?:nên|vì vậy|vì thế|do đó|cho nên|thì|và|nhưng|còn|do vậy)(?!\p{L})[\s,]*/iu;
const DEPENDENT_SENTENCE = /^(?:vì vậy|vì thế|do đó|do vậy|như vậy|từ đó|theo đó|cho nên|therefore|thus|so)(?!\p{L})/iu;
const HAS_KG_FIGURE = /\d\s*(?:kg|ký|kilo)/iu;

/** Pure: does this sentence state the user's own current/historical weight as a number? Returns the figure and whether it is framed as past. */
export function weightClaimIn(sentence: string): { kg: number; historical: boolean; dated: boolean } | null {
  const raw = sentence.trim();
  if (!raw || /\?\s*[*_)"”']*$/.test(raw)) return null; // a question put to the user
  const f = foldVi(raw);
  if (TRAJECTORY.test(f)) return null;
  if (NOT_A_FACT.test(f)) return null; // a condition / example anywhere in the sentence makes it non-factual (the conservative side: keep)
  for (const re of CLAIMS) {
    const m = re.exec(f);
    if (!m) continue;
    // target / ideal / forecast wording only excludes the claim when it belongs to the claim's OWN noun phrase: the part of the
    // clause BEFORE the figure ("cân nặng mục tiêu của bạn là 68 kg"), not wording after it ("… 99 kg, thấp hơn mục tiêu")
    const upToFigure = f.slice(0, m.index + m[0].length);
    const clause = upToFigure.split(/[,;:]| nhung | va | trong khi /).pop() ?? upToFigure;
    if (NOT_CURRENT_WEIGHT.test(clause)) return null;
    return { kg: num(m[1]), historical: HISTORICAL.test(f), dated: DATED.test(f) };
  }
  return null;
}

/** The clauses of a removed sentence that carry a safety cue and no weight figure, made standalone; null when none can stand alone. */
function safetyClausesOf(sentence: string): string | null {
  const kept = sentence.split(/\s*[,;]\s+/)
    .filter((c) => SAFETY_CUE.test(c.toLowerCase()) && !HAS_KG_FIGURE.test(c) && !weightClaimIn(c))
    .map((c) => c.trim().replace(LEAD_CONNECTIVE, "").replace(/[.!?\s]+$/u, ""))
    .filter((c) => c.length >= 8);
  if (!kept.length) return null;
  const joined = kept.join(", ");
  return `${joined[0].toUpperCase()}${joined.slice(1)}.`;
}

export function groundPersonalWeightClaims(answer: string, ev: PersonalWeightEvidence): PersonalWeightResult {
  const userFigures = figuresIn([ev.question, ...(ev.sessionUserMessages ?? [])]);
  const reasons: string[] = [];
  const removed: string[] = [];
  let safetyLost = false;

  const supported = (claim: { kg: number; historical: boolean; dated: boolean }): string | null => {
    if (userFigures.some((u) => matches(claim.kg, u))) return null; // the user said it in this conversation (provenance: the user, not a record)
    const hit = ev.sourced.filter((s) => matches(claim.kg, s.kg));
    if (!hit.length) return "unsourced";
    if (claim.historical) return null;
    const current = hit.filter((s) => s.role === "LATEST_MEASURED" || s.role === "PROFILE_REPORTED");
    if (!current.length) return "history_as_current";
    const fresh = current.some((s) => s.role === "PROFILE_REPORTED" || s.ageDays == null || s.ageDays <= STALE_AFTER_DAYS);
    if (!fresh && !claim.dated) return "stale_as_current";
    return null;
  };

  const lines = answer.split("\n").map((line) => {
    if (!line.trim()) return line;
    const prefix = LINE_PREFIX.exec(line)?.[1] ?? "";
    const body = line.slice(prefix.length);
    const sentences = body.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    let changed = false;
    let prevRemoved = false;
    for (const s of sentences) {
      const claim = weightClaimIn(s);
      const why = claim ? supported(claim) : null;
      if (claim && why) {
        removed.push(s.trim()); reasons.push(why); changed = true; prevRemoved = true;
        if (SAFETY_CUE.test(s.toLowerCase())) { const standalone = safetyClausesOf(s); if (standalone) kept.push(standalone); else safetyLost = true; }
        continue;
      }
      // a consequence sentence that hangs on the premise just removed ("Vì vậy bạn nên giảm 31 kg…") goes with it — unless it carries a safety cue
      if (prevRemoved && DEPENDENT_SENTENCE.test(s.trim()) && !SAFETY_CUE.test(s.toLowerCase())) { removed.push(s.trim()); reasons.push("dependent_on_removed"); changed = true; continue; }
      prevRemoved = false;
      kept.push(s);
    }
    if (!changed) return line;
    if (!kept.length) return null;
    let rebuilt = kept.join(" ");
    if ((rebuilt.match(/\*\*/g) ?? []).length % 2 === 1) rebuilt = rebuilt.replace(/\*\*/g, "");
    return `${prefix}${rebuilt}`;
  });
  if (!removed.length) return { answer, removed, reasons };

  const cleaned = lines.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // the notice must not say "no weight on record" when every removed figure WAS on record but old / previous
  const figureReasons = reasons.filter((r) => r !== "dependent_on_removed");
  const notice = figureReasons.length && figureReasons.every((r) => r === "stale_as_current" || r === "history_as_current") ? STALE_OR_HISTORY_NOTICE : NO_VERIFIED_WEIGHT_NOTICE;
  const tail = safetyLost && !/bác sĩ|chuyên gia/i.test(cleaned) ? `${notice}\n\n${GENERIC_SAFETY_REFERRAL}` : notice;
  // The original is NEVER returned when something was removed (unlike the fidelity guard): that would let the unsourced figure through.
  return { answer: cleaned ? `${cleaned}\n\n${tail}` : tail, removed, reasons };
}

// ── evidence builders (pure) ────────────────────────────────────────────────────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 400;
const daysSince = (iso: unknown, now: number): number | null => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
};

/** V2: from the projected `progress.get_body_measurements` result (the only V2 tool that exposes the user's measured / profile weight). */
export function weightEvidenceFromV2ToolData(toolData: ReadonlyMap<string, unknown>): SourcedWeight[] {
  const d = toolData.get("progress.get_body_measurements") as any;
  if (!d || d.available !== true) return [];
  const out: SourcedWeight[] = [];
  const age = typeof d.observations?.latestAgeDays === "number" ? d.observations.latestAgeDays : null;
  if (isNum(d.latest?.weightKg)) out.push({ kg: d.latest.weightKg, role: "LATEST_MEASURED", ageDays: age });
  if (isNum(d.previous?.weightKg)) out.push({ kg: d.previous.weightKg, role: "PREVIOUS_MEASURED" });
  if (d.gap?.state === "AVAILABLE" && d.gap.currentSource === "PROFILE_REPORTED" && isNum(d.gap.currentKg)) out.push({ kg: d.gap.currentKg, role: "PROFILE_REPORTED" });
  // the start of the observed trajectory is derivable from the data the model saw (latest − observed change): a historical, sourced figure
  const change = d.observedTrajectory?.state === "AVAILABLE" ? d.observedTrajectory.observedChangeKg : null;
  if (isNum(d.latest?.weightKg) && typeof change === "number" && Number.isFinite(change)) { const start = Math.round((d.latest.weightKg - change) * 10) / 10; if (isNum(start)) out.push({ kg: start, role: "PREVIOUS_MEASURED" }); }
  return out;
}

/** V1: from the personalization context the orchestrator already holds for THIS authenticated user. */
export function weightEvidenceFromV1Context(ctx: { profile?: any; latestInBody?: any; inBodyHistory?: any[] } | null | undefined, now: number = Date.now()): SourcedWeight[] {
  if (!ctx) return [];
  const out: SourcedWeight[] = [];
  const hist = Array.isArray(ctx.inBodyHistory) ? ctx.inBodyHistory : [];
  const w = (h: any) => (isNum(h?.weight) ? h.weight : isNum(h?.weightKg) ? h.weightKg : null);
  const latestFromHistory = hist.length ? w(hist[0]) : null;
  let hasMeasured = false;
  if (latestFromHistory != null) { out.push({ kg: latestFromHistory, role: "LATEST_MEASURED", ageDays: daysSince(hist[0]?.date ?? hist[0]?.dateOnly, now) }); hasMeasured = true; }
  else if (isNum(ctx.latestInBody?.weightKg ?? ctx.profile?.inBody?.weightKg)) { out.push({ kg: (ctx.latestInBody?.weightKg ?? ctx.profile?.inBody?.weightKg) as number, role: "LATEST_MEASURED", ageDays: daysSince(ctx.latestInBody?.measuredAt ?? ctx.profile?.inBody?.measuredAt, now) }); hasMeasured = true; }
  for (const h of hist.slice(1)) { const v = w(h); if (v != null) out.push({ kg: v, role: "PREVIOUS_MEASURED" }); }
  // V1 derives profile.currentWeightKg as `latestInBody.weightKg ?? profile.currentWeight` (profile_extractor.ts): when a measurement exists it IS that
  // measurement (and carries its age), so it is only a separate "profile-reported" source when no measurement exists
  if (!hasMeasured && isNum(ctx.profile?.currentWeightKg)) out.push({ kg: ctx.profile.currentWeightKg, role: "PROFILE_REPORTED" });
  return out;
}
