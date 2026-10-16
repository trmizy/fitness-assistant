/**
 * Phase 4.2 — user-facing training-progress answers from TrainingCoachState.training
 * (docs/ai-product/phase4-2-training-coach-integration.md).
 *
 * This module only (a) recognises a training-progress READ question,
 * (b) renders deterministic facts from the authoritative CoachState and
 * (c) optionally asks the model for ONE bounded wording of a holistic summary,
 * whose output is validated against those same facts and discarded on any
 * mismatch. It computes no analytics: every number it prints is a field of
 * fitness-service's TrainingAnalyticsWindow.
 *
 * It rides the EXISTING `READ_STATE` route (new topic value in the router's
 * TS topic union only); it adds nothing to SemanticInterpretationSchema and
 * nothing to the LLM routing prompt/enum.
 */
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import type { AgentIdentity } from "../../services/fitness-agent-tools";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import { getCoachStateV0, hasTraining, type TrainingCoachState } from "../../services/coach-state/coach-state";
import { callLlmJson, NARRATION_BUDGET } from "../../llm/json_llm_call.util";
import { unifiedCoachMode } from "../index";

export type TrainingQuestionClass =
  | "ADHERENCE" | "FREQUENCY" | "VOLUME" | "PROGRESSION" | "EFFORT" | "PLATEAU" | "SUMMARY";

// ── recognition (diacritic-stripped text from normalizeAgentText) ──────────

const PERSONAL = /(cua (toi|minh)\b|\b(toi|minh|em)\b|\bmy\b|\bi\b)/;
const DEFINITION = /(\bla gi\b|what is|nghia la|khac (gi|nhau)|cach tinh|la the nao)/;
const RECOMMEND_OR_ACTION =
  /(\bnen\b|co nen|goi y|de xuat|tu van|should|recommend|(chinh|doi|sua|dieu chinh|cap nhat|lap lai|tao lai|len lai|thay)\s+(lai\s+)?(giup|lich|chuong trinh|plan|buoi)|giup (toi|minh).*(chinh|doi|sua|tao|lap))/;
const TRAIN_WORD = /(\btap\b|tap luyen|buoi tap|workout|\bgym\b|volume|khoi luong|cuong do|\brpe\b|\brir\b|plateau|bai tap|\bbuoi\b)/;
const TIME_CUE = /(\d+\s*ngay|thang (nay|qua|truoc)|tuan (nay|qua|truoc)|gan day|dao nay|vua roi|hom nay|1 thang|mot thang|thoi gian qua|gan nhat)/;
const MUSCLE_WORD = /(\bchan\b|\bdui\b|nguc|\blung\b|\bvai\b|\btay\b|\bbung\b|\bmong\b|bap chan|\bcore\b)/;

/** exercise vocabulary users type → substrings expected in the (normalized) catalog name */
const EXERCISE_ALIASES: Record<string, string[]> = {
  bench: ["bench", "day nguc"],
  squat: ["squat", "ngoi xom"],
  deadlift: ["deadlift", "keo tau"],
  ohp: ["overhead press", "shoulder press", "day vai"],
  "overhead press": ["overhead press", "shoulder press", "day vai"],
  row: ["row", "keo ngang"],
  "pull up": ["pull-up", "pull up", "pullup", "keo xa"],
  pullup: ["pull-up", "pull up", "pullup", "keo xa"],
  "lat pulldown": ["lat pulldown", "pulldown", "keo xuong"],
  curl: ["curl"],
  lunge: ["lunge"],
};

export function classifyTrainingQuestion(text: string): TrainingQuestionClass | null {
  const s = normalizeAgentText(text);
  if (!PERSONAL.test(s)) return null;
  if (DEFINITION.test(s) && !/cua (toi|minh)/.test(s)) return null;
  if (RECOMMEND_OR_ACTION.test(s)) return null;
  const time = TIME_CUE.test(s);
  const train = TRAIN_WORD.test(s);
  const exercise = detectExerciseMention(s) !== null;

  if (/(plateau|chung lai|khong tien bo|bi (dung|ket)|dung (tien bo|lai))/.test(s)) return "PLATEAU";
  if ((/(tien bo|manh (len|hon)|tang (tai|kg)|1rm|e1rm|cai thien)/.test(s)) && (exercise || train)) return "PROGRESSION";
  if (exercise && (time || /(dao nay|gan day)/.test(s)) && /(the nao|ra sao|duoc khong|on khong)/.test(s)) return "PROGRESSION";
  if (/(volume|khoi luong|tong tai)/.test(s) && (time || /hien (tai|nay)/.test(s) || MUSCLE_WORD.test(s))) return "VOLUME";
  if (/(cuong do|\brpe\b|\brir\b)/.test(s) && (train || time)) return "EFFORT";
  if (/(\bdeu\b|bo (may|bao nhieu|\d+)? ?buoi|bo buoi|bo lo|hoan thanh|duoc bao nhieu buoi|bao nhieu buoi|adherence|dung lich)/.test(s) && (train || /\bbuoi\b/.test(s))) {
    if (/\bdeu\b/.test(s) || /(bo |bo lo|hoan thanh|adherence|dung lich)/.test(s)) return "ADHERENCE";
    if (time) return "FREQUENCY";
  }
  if (/(\bbuoi\b)/.test(s) && time && /(bao nhieu|may)/.test(s)) return "FREQUENCY";
  if (/\btap\b/.test(s) && time && /(on khong|the nao|ra sao|duoc khong|tot khong|co on)/.test(s)) return "SUMMARY";
  return null;
}

export function detectExerciseMention(s: string): { key: string; aliases: string[] } | null {
  for (const [key, aliases] of Object.entries(EXERCISE_ALIASES)) {
    if (new RegExp(`(^|\\s)${key.replace(/ /g, "\\s+")}(\\s|$|[?.!,])`).test(s)) return { key, aliases };
  }
  return null;
}

/** "28 ngày qua" → 28 (only inside the endpoint's 7..90 bound); anything else → undefined (server default 28). */
export function requestedWindowDays(text: string): number | undefined {
  const m = /(\d{1,3})\s*ngay/.exec(normalizeAgentText(text));
  if (!m) return undefined;
  const d = Number(m[1]);
  return Number.isInteger(d) && d >= 7 && d <= 90 ? d : undefined;
}

// ── deterministic rendering ────────────────────────────────────────────────

type Training = TrainingCoachState["training"];
const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const fmt = (n: number) => nf.format(n);
const pct = (r: number) => Math.round(r * 100);

const MUSCLE_KEYS: Array<{ re: RegExp; keys: string[] }> = [
  { re: /bap chan/, keys: ["calves"] },
  { re: /\bmong\b/, keys: ["glutes"] },
  { re: /(\bchan\b|\bdui\b)/, keys: ["quadriceps", "quads", "hamstrings", "glutes", "calves", "adductors", "abductors"] },
  { re: /nguc/, keys: ["chest", "pectoral"] },
  { re: /\blung\b/, keys: ["lats", "back", "traps", "spinal", "rhomboid"] },
  { re: /\bvai\b/, keys: ["shoulders", "delts"] },
  { re: /\btay\b/, keys: ["biceps", "triceps", "forearms", "brachialis"] },
  { re: /(\bbung\b|\bcore\b)/, keys: ["abdominals", "abs", "core", "obliques", "transverse"] },
];

function qualityNote(t: Training): string | null {
  switch (t.dataQuality) {
    case "INSUFFICIENT_HISTORY": return "Hiện có dữ liệu nhưng chưa đủ lịch sử để kết luận xu hướng chắc chắn.";
    case "PARTIAL": return "Dữ liệu trong khoảng này còn khá ít nên chỉ mang tính tham khảo.";
    default: return null;
  }
}

/** NO_DATA / STALE short-circuit — never rendered as poor adherence, plateau or "never trained". */
function emptyAnswer(t: Training): string | null {
  const d = t.period.days;
  if (t.dataQuality === "NO_DATA") return `Chưa có dữ liệu tập trong ${d} ngày gần đây (không có lịch tập hay buổi tập nào được ghi nhận) để đánh giá.`;
  if (t.dataQuality === "STALE") return `Không có buổi tập hay lịch tập nào trong ${d} ngày gần đây, dù trước đó bạn đã có dữ liệu tập — nên mình chưa có số liệu mới để đánh giá cho khoảng này.`;
  return null;
}

function adherenceText(t: Training): string {
  const d = t.period.days;
  const a = t.adherence;
  if (a.state === "NO_SCHEDULE") {
    const n = t.frequency.trainingDaysLogged;
    return `Trong ${d} ngày gần đây bạn có ${n} ngày tập được ghi nhận, nhưng không có lịch tập nào trong khoảng này nên mình chưa tính được tỷ lệ hoàn thành theo lịch.`;
  }
  let s = `Trong ${d} ngày gần đây bạn có ${a.scheduledSessions} buổi theo lịch, hoàn thành ${a.completedSessions}, chưa hoàn thành ${a.missedSessions ?? 0} (tỷ lệ ${pct(a.completionRate ?? 0)}%).`;
  if ((a.missedSessions ?? 0) > 0) s += " Buổi chưa hoàn thành gồm cả buổi bỏ qua và buổi hôm nay chưa bắt đầu.";
  for (const sig of t.signals) {
    if (sig.code === "TRAINING_ADHERENCE_GOOD") s += ` Mức này đạt ngưỡng "đều" của hệ thống (từ ${sig.basis.thresholdPct}% trở lên).`;
    if (sig.code === "TRAINING_ADHERENCE_LOW") s += ` Mức này thấp theo ngưỡng của hệ thống (từ ${sig.basis.thresholdPct}% trở xuống).`;
  }
  return s;
}

function frequencyText(t: Training): string {
  const d = t.period.days;
  const f = t.frequency;
  const parts: string[] = [];
  if (t.adherence.state === "MEASURED") parts.push(`${t.adherence.completedSessions} buổi theo lịch đã hoàn thành`);
  parts.push(`${f.trainingDaysLogged} ngày có ghi nhận tập`);
  let s = `Trong ${d} ngày gần đây: ${parts.join(", ")}.`;
  if (f.completedPerWeek != null) s += ` Trung bình khoảng ${fmt(f.completedPerWeek)} buổi/tuần.`;
  if (f.scheduledPerWeek != null) s += ` Lịch của bạn khoảng ${fmt(f.scheduledPerWeek)} buổi/tuần.`;
  return s;
}

function volumeText(t: Training, question: string): string {
  const v = t.volume;
  const s0 = normalizeAgentText(question);
  const d = t.period.days;
  if (v.loadedSetCount === 0) {
    return `Trong ${d} ngày gần đây có ${v.completedSetCount} set đã hoàn thành nhưng chưa set nào ghi đủ cả mức tạ lẫn số lần, nên mình chưa tính được khối lượng tạ.`;
  }
  const wanted = MUSCLE_KEYS.filter((m) => m.re.test(s0));
  let s: string;
  if (wanted.length) {
    const keys = new Set(wanted.flatMap((m) => m.keys));
    const rows = Object.entries(v.byMuscleGroupKg).filter(([g]) => [...keys].some((k) => g.toLowerCase().includes(k)));
    if (rows.length === 0) {
      s = `Trong ${d} ngày gần đây mình không thấy nhóm cơ bạn hỏi trong dữ liệu khối lượng tạ.`;
    } else {
      rows.sort((a, b) => b[1] - a[1]);
      s = `Khối lượng tạ (Σ tạ × số lần, các set đã hoàn thành) trong ${d} ngày gần đây theo nhóm cơ: ${rows.map(([g, kg]) => `${g} ${fmt(kg)} kg`).join("; ")}.`;
    }
  } else {
    s = `Tổng khối lượng tạ (Σ tạ × số lần, các set đã hoàn thành) trong ${d} ngày gần đây là ${fmt(v.totalVolumeLoadKg)} kg, từ ${v.loadedSetCount} set có ghi tạ và số lần.`;
    const top = Object.entries(v.byMuscleGroupKg).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) s += ` Các nhóm cơ có khối lượng cao nhất: ${top.map(([g, kg]) => `${g} ${fmt(kg)} kg`).join("; ")}.`;
  }
  if (v.volumeTrendPercent != null && v.byWeek.length >= 2) {
    s += ` So tuần đầu với tuần cuối có dữ liệu: ${v.volumeTrendPercent > 0 ? "+" : ""}${fmt(v.volumeTrendPercent)}%.`;
  }
  s += " Mỗi nhóm cơ được tính trọn khối lượng của set nên các nhóm cộng lại có thể lớn hơn tổng. Mình chỉ mô tả số liệu, chưa đánh giá mức này cao hay thấp so với chuẩn nào.";
  return s;
}

function matchExercises(t: Training, s0: string): { mentioned: boolean; matches: Training["progression"]["exercises"] } {
  const mention = detectExerciseMention(s0);
  if (!mention) return { mentioned: false, matches: [] };
  const norm = (x: string) => normalizeAgentText(x);
  const matches = t.progression.exercises.filter((e) => mention.aliases.some((a) => norm(e.exerciseName).includes(a)));
  return { mentioned: true, matches };
}

function exerciseLine(e: Training["progression"]["exercises"][number]): string {
  if (e.changePct == null || e.dataQuality === "INSUFFICIENT_HISTORY") {
    return `${e.exerciseName}: mới có ${e.weeksObserved} tuần có dữ liệu (ước tính 1RM hiện khoảng ${fmt(e.currentE1rmKg)} kg) nên chưa đủ lịch sử để kết luận xu hướng.`;
  }
  const dir = e.changePct > 0 ? "tăng" : e.changePct < 0 ? "giảm" : "không đổi";
  const change = e.changePct === 0 ? "" : ` (${e.changePct > 0 ? "+" : ""}${fmt(e.changePct)}%)`;
  const caveat = e.dataQuality === "PARTIAL" ? " (mới 2 tuần dữ liệu, chỉ mang tính tham khảo)" : "";
  return `${e.exerciseName}: ước tính 1RM ${dir} từ ${fmt(e.baselineE1rmKg)} kg lên ${fmt(e.currentE1rmKg)} kg${change} qua ${e.weeksObserved} tuần có dữ liệu${caveat}.`;
}

function progressionText(t: Training, question: string): string {
  const s0 = normalizeAgentText(question);
  const { mentioned, matches } = matchExercises(t, s0);
  if (mentioned) {
    if (matches.length === 0) return `Mình chưa thấy bài đó trong dữ liệu ${t.period.days} ngày gần đây (mình chỉ phân tích tối đa 5 bài bạn tập nhiều nhất), nên chưa có số liệu tiến triển cho bài này.`;
    if (matches.length > 1) return `Có nhiều bài khớp với câu hỏi của bạn: ${matches.map((m) => m.exerciseName).join("; ")}. Bạn muốn xem bài nào?`;
    return exerciseLine(matches[0]);
  }
  if (t.progression.exercises.length === 0) return `Trong ${t.period.days} ngày gần đây chưa có bài nào đủ dữ liệu (tạ và số lần, không tính set khởi động) để ước tính tiến triển.`;
  const lines = t.progression.exercises.slice(0, 5).map(exerciseLine);
  return `Ước tính 1RM theo từng bài trong ${t.period.days} ngày gần đây (các bài bạn tập nhiều nhất):\n- ${lines.join("\n- ")}`;
}

function effortText(t: Training): string {
  const { rpe, rir, sessionFeedback } = t.effort;
  const d = t.period.days;
  const parts: string[] = [];
  const cover = (label: string, e: typeof rpe) =>
    e.observedSets === 0
      ? `${label}: bạn chưa nhập ở set nào (${e.totalCompletedSets} set hoàn thành) nên không có số liệu.`
      : `${label} được nhập ở ${e.observedSets}/${e.totalCompletedSets} set` +
        (e.weeklyAvg.length ? `, trung bình theo tuần: ${e.weeklyAvg.map(fmt).join(" → ")}` : "") +
        (e.trend ? ` (xu hướng ${e.trend === "increasing" ? "tăng dần" : e.trend === "decreasing" ? "giảm dần" : "ổn định"})` : "") + ".";
  parts.push(cover("RPE", rpe), cover("RIR", rir));
  if (sessionFeedback.feedbackCount > 0 && sessionFeedback.averageSessionRpe != null && sessionFeedback.sessionRpeSource === "session_feedback") {
    parts.push(`RPE trung bình theo đánh giá buổi tập: ${fmt(sessionFeedback.averageSessionRpe)} (từ ${sessionFeedback.feedbackCount} buổi có đánh giá).`);
  }
  const partial = [rpe, rir].some((e) => e.observedSets > 0 && e.observedSets < e.totalCompletedSets);
  let s = `Cường độ trong ${d} ngày gần đây: ${parts.join(" ")}`;
  if (partial) s += " RPE/RIR chỉ được nhập ở một phần số set nên chỉ phản ánh phần đó, không đại diện cho toàn bộ buổi tập.";
  return s;
}

function plateauText(t: Training): string {
  const prog = t.progression.exercises.slice(0, 3).map(exerciseLine);
  let s = "Hiện phân tích theo cửa sổ gần đây của mình chưa có phân loại plateau đủ tin cậy, nên mình không kết luận bạn có đang plateau hay không.";
  if (prog.length) s += `\nSố liệu tiến triển hiện có:\n- ${prog.join("\n- ")}`;
  return s;
}

function summaryText(t: Training): string {
  const lines = [adherenceText(t), frequencyText(t)];
  if (t.volume.loadedSetCount > 0) lines.push(`Tổng khối lượng tạ ${fmt(t.volume.totalVolumeLoadKg)} kg (Σ tạ × số lần, set hoàn thành).`);
  const withTrend = t.progression.exercises.filter((e) => e.changePct != null && e.dataQuality !== "INSUFFICIENT_HISTORY").slice(0, 3);
  if (withTrend.length) lines.push(`Ước tính 1RM: ${withTrend.map((e) => `${e.exerciseName} ${e.changePct! > 0 ? "+" : ""}${fmt(e.changePct!)}%`).join("; ")}.`);
  if (t.effort.rpe.observedSets > 0 || t.effort.rir.observedSets > 0) {
    lines.push(`RPE nhập ở ${t.effort.rpe.observedSets}/${t.effort.rpe.totalCompletedSets} set, RIR ở ${t.effort.rir.observedSets}/${t.effort.rir.totalCompletedSets} set.`);
  }
  return lines.join(" ");
}

export function renderTrainingAnswer(state: TrainingCoachState, cls: TrainingQuestionClass, question: string): string {
  const t = state.training;
  // plateau honesty applies even with sparse data; everything else short-circuits on empty state
  const empty = emptyAnswer(t);
  if (empty) return cls === "PLATEAU" ? `${empty} Phân loại plateau cũng chưa khả dụng trong phân tích theo cửa sổ gần đây.` : empty;
  let body: string;
  switch (cls) {
    case "ADHERENCE": body = adherenceText(t); break;
    case "FREQUENCY": body = frequencyText(t); break;
    case "VOLUME": body = volumeText(t, question); break;
    case "PROGRESSION": body = progressionText(t, question); break;
    case "EFFORT": body = effortText(t); break;
    case "PLATEAU": body = plateauText(t); break;
    default: body = summaryText(t);
  }
  const note = qualityNote(t);
  return note && cls !== "PLATEAU" ? `${body} ${note}` : body;
}

// ── bounded narration (SUMMARY only) ───────────────────────────────────────

const NarrationSchema = z.object({ summary: z.string().min(10).max(700) });

/** Compact structured snapshot — derived state only, never sets/reps/weights history. */
export function narrationSnapshot(state: TrainingCoachState): Record<string, unknown> {
  const t = state.training;
  return {
    mucTieu: state.goal?.type ?? null,
    soNgay: t.period.days,
    chatLuongDuLieu: t.dataQuality,
    lichTap: t.adherence.state === "MEASURED"
      ? { theoLich: t.adherence.scheduledSessions, hoanThanh: t.adherence.completedSessions, chuaHoanThanh: t.adherence.missedSessions, tyLePhanTram: pct(t.adherence.completionRate ?? 0) }
      : { khongCoLich: true, ngayCoTap: t.frequency.trainingDaysLogged },
    buoiMoiTuan: t.frequency.completedPerWeek,
    tongKhoiLuongKg: t.volume.loadedSetCount > 0 ? t.volume.totalVolumeLoadKg : null,
    tienTrien: t.progression.exercises.slice(0, 3).map((e) => ({ bai: e.exerciseName, phanTramThayDoi: e.changePct, soTuan: e.weeksObserved })),
    rpeDaNhap: `${t.effort.rpe.observedSets}/${t.effort.rpe.totalCompletedSets}`,
    tinHieu: t.signals.map((s) => s.code),
  };
}

function numbersIn(s: string): number[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
}

function collectNumbers(o: unknown, out: Set<number>): void {
  if (typeof o === "number" && Number.isFinite(o)) { out.add(o); out.add(Math.abs(o)); out.add(Math.round(o)); }
  else if (typeof o === "string") numbersIn(o).forEach((n) => out.add(n));
  else if (Array.isArray(o)) o.forEach((x) => collectNumbers(x, out));
  else if (o && typeof o === "object") Object.values(o as Record<string, unknown>).forEach((x) => collectNumbers(x, out));
}

/**
 * Fact-bound validation of model wording. Rejects when the text (a) mentions a number that is not in the snapshot,
 * (b) asserts a plateau/diagnosis the state does not carry, or (c) speaks about sleep/recovery/HRV (not in Phase-4.1 data).
 */
export function validateNarration(text: string, state: TrainingCoachState): { ok: boolean; reason?: string } {
  const s = normalizeAgentText(text);
  if (/(plateau|chung lai|bi dung|kiet suc|overtrain|qua tai)/.test(s)) return { ok: false, reason: "unsupported_diagnosis" };
  if (/(giac ngu|\bngu\b|hrv|nhip tim|phuc hoi|stress|cang thang|dinh duong|an uong|\bcalo)/.test(s)) return { ok: false, reason: "unsupported_domain" };
  const allowed = new Set<number>();
  collectNumbers(narrationSnapshot(state), allowed);
  for (const n of numbersIn(s)) if (!allowed.has(n) && !allowed.has(Math.round(n))) return { ok: false, reason: "number_not_in_state" };
  return { ok: true };
}

export const trainingCoachDeps = {
  narrate: async (state: TrainingCoachState, userId: string): Promise<string | null> => {
    const prompt = [
      "Bạn là huấn luyện viên. Viết 2–3 câu tiếng Việt tóm tắt tình hình tập luyện của người dùng.",
      "CHỈ được dùng các con số và mục trong JSON dưới đây; không tự tính lại, không thêm số mới.",
      "Không nói về giấc ngủ, phục hồi, dinh dưỡng, chẩn đoán hay plateau. Không đưa lời khuyên thay đổi lịch.",
      'Trả về JSON: {"summary":"..."}',
      JSON.stringify(narrationSnapshot(state)),
    ].join("\n");
    const out = await callLlmJson(prompt, NarrationSchema, {
      userId, phase: "training-coach-narration", numPredict: 220, attempts: NARRATION_BUDGET.attempts,
      timeoutMs: NARRATION_BUDGET.timeoutMs, purpose: "RECOMMENDATION_NARRATION", redactErrorDetail: true, logPrefix: "[training-coach]",
    });
    return out?.summary ?? null;
  },
};

// ── entry point used by readState("TRAINING_PROGRESS") ────────────────────

export interface TrainingAnswer {
  text: string;
  source: string;
  facts: Record<string, unknown>;
}

export async function answerTrainingProgress(identity: AgentIdentity, question: string): Promise<TrainingAnswer> {
  const started = Date.now();
  const cls = classifyTrainingQuestion(question) ?? "SUMMARY";
  const days = requestedWindowDays(question);
  const read = await getCoachStateV0(identity, { days, includeGoal: cls === "SUMMARY" });
  let llmCalls = 0;
  let usedNarration = false;
  let text: string;
  let dataQuality: string | null = null;

  if (read.status !== "ok" || !hasTraining(read.value)) {
    // upstream failure / absence is NEVER presented as "no data"
    text = "Mình chưa đọc được dữ liệu tập luyện của bạn lúc này nên chưa đánh giá được. Bạn thử lại sau giây lát nhé.";
  } else {
    const state = read.value as TrainingCoachState;
    dataQuality = state.training.dataQuality;
    text = renderTrainingAnswer(state, cls, question);
    const holistic = cls === "SUMMARY" && (state.training.dataQuality === "SUFFICIENT" || state.training.dataQuality === "PARTIAL");
    if (holistic && unifiedCoachMode() === "on") {
      llmCalls = 1;
      const narrated = await trainingCoachDeps.narrate(state, identity.userId).catch(() => null);
      if (narrated && validateNarration(narrated, state).ok) {
        usedNarration = true;
        const note = qualityNote(state.training);
        text = `${narrated.trim()}${note ? ` ${note}` : ""}`;
      }
    }
  }

  // Privacy: classes/counters/latency only — no loads, RPE values, notes or prompt.
  logger.info({
    event: "training_coach_answer", answerClass: cls, windowDays: days ?? 28, dataQuality,
    usedNarration, llmCalls, analyticsReadOutcome: read.status, latencyMs: Date.now() - started,
  }, "training_coach_answer");

  return { text, source: "fitness-service:/stats/training-window", facts: { answerClass: cls, dataQuality, llmCalls, usedNarration, analyticsReadOutcome: read.status } };
}
