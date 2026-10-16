/**
 * Phase 4.5 — longitudinal PROGRESS REVIEW composed from CoachState slices
 * (docs/ai-product/phase4-5-progress-review-integration.md).
 *
 * Pure composition: it recomputes no analytics. Facts come from fitness-service
 * slices (training / nutrition / body+goal). The review keeps FACT separate from
 * safe INTERPRETATION and contains no RECOMMENDATION and no causal claim.
 *
 * Rides the EXISTING `READ_STATE` route via a TypeScript-only ReadTopic
 * ("PROGRESS_REVIEW"); nothing is added to SemanticInterpretationSchema or to
 * the LLM routing prompt/enum.
 */
import { logger } from "@gym-coach/shared";
import { z } from "zod";
import type { AgentIdentity } from "../../services/fitness-agent-tools";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import { readCoachStateSlices, type CoachStateV0 } from "../../services/coach-state/coach-state";
import type { AuthoritativeRead } from "../../services/enterprise-data/types";
import { callLlmJson, NARRATION_BUDGET } from "../../llm/json_llm_call.util";
import { unifiedCoachMode } from "../index";

// ── recognition ──────────────────────────────────────────────────────────

export type ProgressQuestionClass =
  | "HOLISTIC"        // "Dạo này tôi tiến triển thế nào?" — all available domains
  | "DIRECTION"       // "đi đúng hướng / tiến gần mục tiêu" — descriptive direction only
  | "SCHEDULE"        // "đúng tiến độ?" — deadline semantics (currently NOT_EVALUABLE)
  | "GAP"             // "còn cách mục tiêu bao nhiêu kg / đã giảm bao nhiêu"
  | "LATEST_WEIGHT"   // "cân gần nhất / lần đo gần nhất"
  | "NUTRITION_READBACK"; // "protein/calo trung bình của tôi"

const PERSONAL = /(cua (toi|minh)\b|\b(toi|minh|em)\b)/;
const DEFINITION = /(\bla gi\b|what is|nghia la|khac (gi|nhau)|cach tinh|la the nao|chinh xac khong)/;
const RECOMMEND_OR_ACTION =
  /(\bnen\b|co nen|goi y|de xuat|tu van|should|recommend|(chinh|doi|sua|dieu chinh|cap nhat|lap lai|tao lai|len lai|thay)\s+(lai\s+)?(giup|lich|chuong trinh|plan|buoi|thuc don|calo)|giup (toi|minh).*(chinh|doi|sua|tao|lap)|chinh (lich|thuc don|calo))/;
const W_BODY = /(can nang|\bkg\b|\bcan\b|inbody|giam can|tang can|muc tieu|so do)/;
const W_NUTRITION = /(an uong|\bcalo|kcal|protein|\bdam\b|bua an|dinh duong|an (gan day|dao nay))/;
const W_TRAINING = /(\btap\b|tap luyen|buoi tap|workout|\bgym\b)/;
const TIME = /(\d+\s*ngay|thang (nay|qua)|tuan (nay|qua)|gan day|dao nay|vua roi|thoi gian qua|gan nhat|hien (tai|nay|gio))/;

export function classifyProgressReviewQuestion(text: string): ProgressQuestionClass | null {
  const s = normalizeAgentText(text);
  if (!PERSONAL.test(s)) return null;
  if (DEFINITION.test(s) && !/cua (toi|minh)/.test(s)) return null;
  if (RECOMMEND_OR_ACTION.test(s)) return null;

  const body = W_BODY.test(s), nutrition = W_NUTRITION.test(s), training = W_TRAINING.test(s);
  const domains = [body, nutrition, training].filter(Boolean).length;

  // deadline semantics first: "đúng tiến độ" must never be answered as "đúng hướng"
  if (/(dung|kip|theo) (tien do|han|ke hoach)|on schedule|on track|bao gio .*(dat|toi) muc tieu|khi nao .*(dat|toi) muc tieu/.test(s)) return "SCHEDULE";
  if (/(di|dang|co) (dung )?huong|tien gan (toi )?muc tieu|gan (toi )?muc tieu|huong (toi )?muc tieu/.test(s)) return "DIRECTION";
  if (/(con )?cach muc tieu|bao nhieu kg (nua|de dat)|(da )?(giam|tang) (duoc )?bao nhieu|chenh lech.*muc tieu/.test(s)) return "GAP";
  if (/(can (nang )?(gan nhat|moi nhat)|lan do (gan nhat|moi nhat)|(gan nhat|moi nhat).*(can nang|inbody)|inbody (gan nhat|moi nhat))/.test(s)) return "LATEST_WEIGHT";
  if (nutrition && !training && /(trung binh|thuc te|da an|gan day|dao nay|thang (nay|qua)|tuan (nay|qua)|\d+\s*ngay)/.test(s) && /(protein|\bdam\b|calo|kcal|an uong)/.test(s)) return "NUTRITION_READBACK";
  // holistic: explicit progress words, or ≥2 distinct domains asked together. A single domain stays with its own owner
  // (training → Phase 4.2 route).
  if (/(tien trien|tinh hinh|tien do|dang the nao|ra sao)/.test(s) && !(training && domains === 1 && !/(tien trien|tinh hinh|tien do)/.test(s))) return "HOLISTIC";
  if (domains >= 2 && (TIME.test(s) || /(on khong|the nao|ra sao|duoc khong)/.test(s))) return "HOLISTIC";
  return null;
}

/** which CoachState slices a class needs (demand-driven) */
export function slicesFor(cls: ProgressQuestionClass): { training: boolean; nutrition: boolean; bodyGoal: boolean } {
  switch (cls) {
    case "HOLISTIC": return { training: true, nutrition: true, bodyGoal: true };
    case "NUTRITION_READBACK": return { training: false, nutrition: true, bodyGoal: false };
    default: return { training: false, nutrition: false, bodyGoal: true };
  }
}

// ── contract ─────────────────────────────────────────────────────────────

export type Quality = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT_HISTORY" | "NO_DATA" | "STALE";
export type Domain = "BODY" | "GOAL" | "TRAINING" | "NUTRITION";
export type DomainState = "OK" | "NO_DATA" | "STALE" | "ERROR" | "ABSENT" | "NOT_REQUESTED";

export interface EvidenceItem {
  domain: Domain;
  kind: string;
  /** primitives only; every number the user may be shown lives here (narration is validated against it) */
  value: Record<string, number | string | boolean | null>;
  quality: Quality;
  provenance?: "MEASURED_INBODY" | "PROFILE_REPORTED" | "PROFILE_TARGET_WEIGHT" | "TRAINING_LOGS" | "NUTRITION_LOGS";
  window: { days: number } | null;
  /** what this fact may NOT be stretched into */
  claimBoundary: "DESCRIPTIVE_ONLY";
}

export type LimitationCode =
  | "NO_TARGET_DEADLINE" | "NO_TARGET" | "NO_CURRENT_WEIGHT" | "BODY_PROFILE_FALLBACK" | "BODY_SINGLE_MEASUREMENT"
  | "BODY_STALE" | "BODY_OUTLIERS_EXCLUDED" | "NUTRITION_PARTIAL_COVERAGE" | "NUTRITION_TARGET_CHANGED"
  | "DOMAIN_NO_DATA" | "DOMAIN_UNAVAILABLE" | "NO_CAUSAL_CLAIMS" | "TRAINING_NO_SCHEDULE";
export interface Limitation { code: LimitationCode; domain?: Domain; detail?: Record<string, number | string> }

export interface ProgressReviewV0 {
  asOf: string;
  /** per-domain read status + data quality, never collapsed into one score */
  domains: Record<Domain, { state: DomainState; quality: Quality | null }>;
  goal: { type: string | null; onTrack: { status: "NOT_EVALUABLE"; reasons: string[] } | null };
  evidence: EvidenceItem[];
  limitations: Limitation[];
  overallCoverage: "COMPLETE_ENOUGH_FOR_SUMMARY" | "PARTIAL" | "INSUFFICIENT";
}

type Slice = { status: "ok"; state: CoachStateV0 } | { status: "error" | "absent" | "not_requested" };
export function toSlice(r: AuthoritativeRead<CoachStateV0> | undefined): Slice {
  if (!r) return { status: "not_requested" };
  if (r.status === "ok") return { status: "ok", state: r.value };
  return { status: r.status };
}

// ── deterministic evidence builder ────────────────────────────────────────

const usable = (q: Quality | null | undefined) => q === "SUFFICIENT" || q === "PARTIAL" || q === "INSUFFICIENT_HISTORY";

export function buildProgressReviewV0(input: { asOf: Date; training: Slice; nutrition: Slice; bodyGoal: Slice }): ProgressReviewV0 {
  const evidence: EvidenceItem[] = [];
  const limitations: Limitation[] = [];
  const domains: ProgressReviewV0["domains"] = {
    BODY: { state: "NOT_REQUESTED", quality: null }, GOAL: { state: "NOT_REQUESTED", quality: null },
    TRAINING: { state: "NOT_REQUESTED", quality: null }, NUTRITION: { state: "NOT_REQUESTED", quality: null },
  };
  const fail = (d: Domain, s: Slice) => {
    domains[d] = { state: s.status === "error" ? "ERROR" : s.status === "absent" ? "ABSENT" : "NOT_REQUESTED", quality: null };
    if (s.status === "error" || s.status === "absent") limitations.push({ code: "DOMAIN_UNAVAILABLE", domain: d });
  };
  const stateOf = (q: Quality): DomainState => (q === "NO_DATA" ? "NO_DATA" : q === "STALE" ? "STALE" : "OK");
  let goalType: string | null = null;
  let onTrack: ProgressReviewV0["goal"]["onTrack"] = null;

  // BODY + GOAL (one upstream read)
  if (input.bodyGoal.status !== "ok") { fail("BODY", input.bodyGoal); domains.GOAL = { ...domains.BODY }; }
  else {
    const b = input.bodyGoal.state.body;
    const gRaw = input.bodyGoal.state.goal;
    const g = gRaw && gRaw.currentTarget && gRaw.gap && gRaw.trajectory && gRaw.dataQuality
      ? (gRaw as Required<NonNullable<CoachStateV0["goal"]>>)
      : null;
    if (b && g) {
      goalType = g.type ?? null;
      domains.BODY = { state: stateOf(b.dataQuality), quality: b.dataQuality };
      const win = { days: b.lookbackDays };
      if (b.dataQuality === "NO_DATA") limitations.push({ code: "DOMAIN_NO_DATA", domain: "BODY" });
      if (b.latest) {
        const gapSrc = g.gap && g.gap.state === "AVAILABLE" ? g.gap.currentSource : "MEASURED_INBODY";
        evidence.push({
          domain: "BODY", kind: "LATEST_MEASURED_WEIGHT", quality: b.dataQuality, provenance: "MEASURED_INBODY", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { weightKg: b.latest.weightKg, measuredAt: b.latest.measuredAt, ageDays: b.latestAgeDays, excludedFromTrend: b.latest.excludedFromTrend, usedForGap: gapSrc === "MEASURED_INBODY" },
        });
      }
      if (b.observations.totalOnRecord === 1) limitations.push({ code: "BODY_SINGLE_MEASUREMENT", domain: "BODY" });
      if (b.dataQuality === "STALE") limitations.push({ code: "BODY_STALE", domain: "BODY", detail: { ageDays: b.latestAgeDays ?? 0 } });
      if (b.quality.outlierCount > 0) limitations.push({ code: "BODY_OUTLIERS_EXCLUDED", domain: "BODY", detail: { count: b.quality.outlierCount } });
      if (b.trends.bodyFat.status === "AVAILABLE") {
        evidence.push({ domain: "BODY", kind: "BODY_FAT_TREND", quality: b.dataQuality, provenance: "MEASURED_INBODY", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { direction: b.trends.bodyFat.direction ?? null, changePerWeekPct: b.trends.bodyFat.changePerWeek ?? null, dataPoints: b.trends.bodyFat.dataPoints } });
      }
      // muscleMass is deliberately NOT surfaced (semantics UNRESOLVED, Phase 4.4)

      domains.GOAL = { state: g.currentTarget.state === "AVAILABLE" || g.type ? "OK" : "NO_DATA", quality: g.dataQuality };
      if (g.currentTarget.state === "AVAILABLE") {
        evidence.push({ domain: "GOAL", kind: "TARGET_WEIGHT", quality: g.dataQuality, provenance: "PROFILE_TARGET_WEIGHT", window: null, claimBoundary: "DESCRIPTIVE_ONLY", value: { targetKg: g.currentTarget.weightKg } });
      } else limitations.push({ code: "NO_TARGET", domain: "GOAL" });
      if (g.gap.state === "AVAILABLE") {
        if (g.gap.currentSource === "PROFILE_REPORTED") limitations.push({ code: "BODY_PROFILE_FALLBACK", domain: "BODY" });
        evidence.push({
          domain: "GOAL", kind: "GAP_TO_TARGET", quality: g.gap.currentSource === "MEASURED_INBODY" ? b.dataQuality : "INSUFFICIENT_HISTORY",
          provenance: g.gap.currentSource, window: null, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { currentKg: g.gap.currentKg, targetKg: g.gap.targetKg, differenceKg: g.gap.differenceKg, absoluteKg: g.gap.absoluteKg, currentAsOf: g.gap.currentAsOf, alternateProfileKg: g.gap.alternateCurrent?.kg ?? null },
        });
      } else if (g.gap.reason === "NO_CURRENT_WEIGHT") limitations.push({ code: "NO_CURRENT_WEIGHT", domain: "GOAL" });
      const o = g.trajectory.observed;
      if (o.state === "AVAILABLE") {
        evidence.push({
          domain: "BODY", kind: "OBSERVED_WEIGHT_TRAJECTORY", quality: b.dataQuality, provenance: "MEASURED_INBODY", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { changeKg: o.observedChangeKg, firstKg: o.firstWeightKg, latestKg: o.latestWeightKg, spanDays: o.timeSpanDays, observations: o.observationCount, ratePerWeekKg: o.observedRateKgPerWeek, directionRelativeToGap: o.directionRelativeToGap },
        });
      }
      onTrack = { status: g.trajectory.onTrack.status, reasons: g.trajectory.onTrack.reasons };
      if (g.currentTarget.state === "AVAILABLE" || g.type) limitations.push({ code: "NO_TARGET_DEADLINE", domain: "GOAL" });
    } else { domains.BODY = { state: "ABSENT", quality: null }; }
  }

  // TRAINING
  if (input.training.status !== "ok") fail("TRAINING", input.training);
  else {
    const t = input.training.state.training;
    if (!t) domains.TRAINING = { state: "ABSENT", quality: null };
    else {
      domains.TRAINING = { state: stateOf(t.dataQuality), quality: t.dataQuality };
      const win = { days: t.period.days };
      if (t.dataQuality === "NO_DATA") limitations.push({ code: "DOMAIN_NO_DATA", domain: "TRAINING" });
      if (t.adherence.state === "MEASURED") {
        evidence.push({ domain: "TRAINING", kind: "SCHEDULED_ADHERENCE", quality: t.adherence.dataQuality, provenance: "TRAINING_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { scheduled: t.adherence.scheduledSessions, completed: t.adherence.completedSessions, missed: t.adherence.missedSessions, completionPct: Math.round((t.adherence.completionRate ?? 0) * 100) } });
      } else if (t.frequency.trainingDaysLogged > 0) {
        limitations.push({ code: "TRAINING_NO_SCHEDULE", domain: "TRAINING" });
        evidence.push({ domain: "TRAINING", kind: "LOGGED_TRAINING_DAYS", quality: t.frequency.dataQuality, provenance: "TRAINING_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY", value: { trainingDays: t.frequency.trainingDaysLogged } });
      }
      const prog = t.progression.exercises.filter((e) => e.changePct != null && e.dataQuality !== "INSUFFICIENT_HISTORY").slice(0, 2);
      for (const e of prog) {
        evidence.push({ domain: "TRAINING", kind: "EXERCISE_E1RM_CHANGE", quality: e.dataQuality, provenance: "TRAINING_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { exercise: e.exerciseName, changePct: e.changePct, baselineKg: e.baselineE1rmKg, currentKg: e.currentE1rmKg, weeks: e.weeksObserved } });
      }
    }
  }

  // NUTRITION
  if (input.nutrition.status !== "ok") fail("NUTRITION", input.nutrition);
  else {
    const n = input.nutrition.state.nutrition;
    if (!n) domains.NUTRITION = { state: "ABSENT", quality: null };
    else {
      domains.NUTRITION = { state: stateOf(n.dataQuality), quality: n.dataQuality };
      const win = { days: n.period.days };
      if (n.dataQuality === "NO_DATA") limitations.push({ code: "DOMAIN_NO_DATA", domain: "NUTRITION" });
      if (n.actual.loggedDays > 0) {
        const t = n.activeTarget.state === "ACTIVE_TARGET" ? n.activeTarget : null;
        evidence.push({ domain: "NUTRITION", kind: "LOGGED_DAYS", quality: n.dataQuality, provenance: "NUTRITION_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
          value: { loggedDays: n.actual.loggedDays, daysInWindow: n.actual.daysInWindow } });
        if (n.actual.calories.averageKcal != null) {
          evidence.push({ domain: "NUTRITION", kind: "AVERAGE_LOGGED_CALORIES", quality: n.dataQuality, provenance: "NUTRITION_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
            value: { averageKcal: n.actual.calories.averageKcal, daysUsed: n.actual.calories.daysUsed, targetKcal: t?.caloriesKcal ?? null, averageDeltaKcal: n.adherence.calories?.averageDelta ?? null } });
        }
        if (n.actual.protein.averageG != null) {
          evidence.push({ domain: "NUTRITION", kind: "AVERAGE_LOGGED_PROTEIN", quality: n.dataQuality, provenance: "NUTRITION_LOGS", window: win, claimBoundary: "DESCRIPTIVE_ONLY",
            value: { averageG: n.actual.protein.averageG, daysUsed: n.actual.protein.daysUsed, targetG: t?.proteinG ?? null, averageDeltaG: n.adherence.protein?.averageDelta ?? null } });
        }
        if (n.actual.loggedDays < n.actual.daysInWindow) limitations.push({ code: "NUTRITION_PARTIAL_COVERAGE", domain: "NUTRITION", detail: { loggedDays: n.actual.loggedDays, daysInWindow: n.actual.daysInWindow } });
      }
      if (n.targetChangedInWindow) limitations.push({ code: "NUTRITION_TARGET_CHANGED", domain: "NUTRITION" });
    }
  }

  limitations.push({ code: "NO_CAUSAL_CLAIMS" });

  const usableDomains = (["BODY", "TRAINING", "NUTRITION"] as Domain[]).filter((d) => domains[d].state === "OK" && usable(domains[d].quality));
  const requested = (["BODY", "TRAINING", "NUTRITION"] as Domain[]).filter((d) => domains[d].state !== "NOT_REQUESTED");
  const overallCoverage: ProgressReviewV0["overallCoverage"] =
    usableDomains.length === 0 ? "INSUFFICIENT"
      : requested.length >= 2 && usableDomains.length === requested.length ? "COMPLETE_ENOUGH_FOR_SUMMARY"
        : "PARTIAL";
  return { asOf: input.asOf.toISOString(), domains, goal: { type: goalType, onTrack }, evidence, limitations, overallCoverage };
}

// ── deterministic rendering ───────────────────────────────────────────────

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
export const fmt = (n: number) => nf.format(n);
export const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;
export const find = (r: ProgressReviewV0, kind: string) => r.evidence.find((e) => e.kind === kind);
export const has = (r: ProgressReviewV0, code: LimitationCode, domain?: Domain) => r.limitations.some((l) => l.code === code && (!domain || l.domain === domain));

function weightSourcePhrase(prov: EvidenceItem["provenance"]): string {
  return prov === "PROFILE_REPORTED" ? "cân nặng bạn khai trong hồ sơ (không phải số đo InBody)" : "cân nặng đo InBody gần nhất";
}

const NO_DEADLINE = "Mình chưa xác định được bạn có đúng tiến độ theo hạn chót hay không, vì hiện chưa có hạn chót hay tốc độ mục tiêu nào được ghi nhận cho cân nặng mục tiêu.";

export function domainUnavailableLine(r: ProgressReviewV0, d: Domain, label: string): string | null {
  const s = r.domains[d].state;
  if (s === "ERROR" || s === "ABSENT") return `${label}: hiện mình chưa đọc được dữ liệu này nên chưa đánh giá được.`;
  if (s === "NO_DATA") return `${label}: chưa có dữ liệu để đánh giá.`;
  if (s === "STALE") return `${label}: không có dữ liệu mới trong khoảng quan sát (trước đó có dữ liệu).`;
  return null;
}

export function bodyLines(r: ProgressReviewV0, opts: { direction?: boolean } = {}): string[] {
  const out: string[] = [];
  const unavailable = domainUnavailableLine(r, "BODY", "Cân nặng");
  const gap = find(r, "GAP_TO_TARGET");
  const traj = find(r, "OBSERVED_WEIGHT_TRAJECTORY");
  const latest = find(r, "LATEST_MEASURED_WEIGHT");
  if (unavailable && !gap) { out.push(unavailable); return out; }
  if (gap) {
    const v = gap.value;
    const diff = v.differenceKg as number;
    out.push(`Hiện tại ${weightSourcePhrase(gap.provenance)} là ${fmt(v.currentKg as number)} kg, mục tiêu ${fmt(v.targetKg as number)} kg — chênh lệch khoảng ${fmt(v.absoluteKg as number)} kg (${diff > 0 ? "đang cao hơn" : diff < 0 ? "đang thấp hơn" : "bằng"} mục tiêu).`);
    if (v.alternateProfileKg != null) out.push(`Hồ sơ của bạn đang ghi ${fmt(v.alternateProfileKg as number)} kg, khác với số đo gần nhất.`);
  } else if (latest) {
    out.push(`Cân nặng đo InBody gần nhất là ${fmt(latest.value.weightKg as number)} kg.`);
  }
  if (traj) {
    const v = traj.value;
    const rel = v.directionRelativeToGap as string;
    const move = `${fmt(v.firstKg as number)} → ${fmt(v.latestKg as number)} kg (${signed(v.changeKg as number)} kg) qua ${v.spanDays} ngày, ${v.observations} lần đo`;
    if (rel === "TOWARD_TARGET") out.push(`Cân nặng đo được đang di chuyển theo hướng mục tiêu: ${move}.`);
    else if (rel === "AWAY_FROM_TARGET") out.push(`Cân nặng đo được đang di chuyển ra xa mục tiêu: ${move}.`);
    else if (rel === "FLAT") out.push(`Cân nặng đo được gần như không đổi: ${move}.`);
    else out.push(`Cân nặng đo được thay đổi ${move}.`);
  } else if (has(r, "BODY_SINGLE_MEASUREMENT")) {
    out.push("Mới có 1 lần đo nên chưa đủ lịch sử để nói về xu hướng cân nặng.");
  } else if (latest && r.domains.BODY.quality === "STALE") {
    out.push(`Lần đo gần nhất cách đây khoảng ${fmt(Number(latest.value.ageDays))} ngày, chưa có số đo mới trong khoảng quan sát.`);
  } else if (!unavailable) {
    out.push("Chưa đủ số lần đo để nói về xu hướng cân nặng.");
  }
  const fat = find(r, "BODY_FAT_TREND");
  if (fat) out.push(`Tỷ lệ mỡ đo được: xu hướng ${fat.value.direction === "UP" ? "tăng" : fat.value.direction === "DOWN" ? "giảm" : "ổn định"} (${fat.value.dataPoints} lần đo).`);
  if (has(r, "BODY_OUTLIERS_EXCLUDED")) out.push("Một số lần đo bị loại khỏi xu hướng vì thay đổi quá nhanh, nên kết quả có độ tin cậy thấp hơn.");
  if (opts.direction && !traj && has(r, "NO_TARGET")) out.push("Bạn chưa đặt cân nặng mục tiêu nên mình chưa nói được hướng so với mục tiêu.");
  return out;
}

export function trainingLines(r: ProgressReviewV0, days: number): string[] {
  const un = domainUnavailableLine(r, "TRAINING", "Tập luyện");
  if (un) return [un];
  const out: string[] = [];
  const a = find(r, "SCHEDULED_ADHERENCE");
  const l = find(r, "LOGGED_TRAINING_DAYS");
  if (a) out.push(`Tập luyện (${days} ngày gần đây): hoàn thành ${a.value.completed}/${a.value.scheduled} buổi theo lịch (${a.value.completionPct}%).`);
  else if (l) out.push(`Tập luyện (${days} ngày gần đây): có ${l.value.trainingDays} ngày tập được ghi nhận, nhưng không có lịch nên mình chưa tính được tỷ lệ hoàn thành theo lịch.`);
  for (const e of r.evidence.filter((x) => x.kind === "EXERCISE_E1RM_CHANGE")) {
    out.push(`${e.value.exercise}: ước tính 1RM ${signed(e.value.changePct as number)}% qua ${e.value.weeks} tuần có dữ liệu.`);
  }
  if (!a && !l) out.push("Tập luyện: chưa đủ dữ liệu trong khoảng quan sát.");
  return out;
}

export function nutritionLines(r: ProgressReviewV0, days: number, which: "both" | "protein" | "calories" = "both"): string[] {
  const un = domainUnavailableLine(r, "NUTRITION", "Ăn uống");
  if (un) return [un];
  const logged = find(r, "LOGGED_DAYS");
  const cal = find(r, "AVERAGE_LOGGED_CALORIES");
  const pro = find(r, "AVERAGE_LOGGED_PROTEIN");
  if (!logged) return ["Ăn uống: chưa có nhật ký ăn uống trong khoảng quan sát."];
  const out: string[] = [];
  const total = logged.value.daysInWindow as number;
  const scope = (logged.value.loggedDays as number) < total ? `Trong các ngày có dữ liệu (${logged.value.loggedDays}/${total} ngày)` : `Trong ${days} ngày gần đây`;
  if (which !== "protein" && cal) {
    const v = cal.value;
    out.push(`${scope}, calo ghi nhận trung bình khoảng ${fmt(v.averageKcal as number)} kcal/ngày (tính trên ${v.daysUsed} ngày có đủ dữ liệu)` +
      (v.targetKcal != null ? `; mục tiêu hiện tại ${fmt(v.targetKcal as number)} kcal${v.averageDeltaKcal != null ? `, chênh ${signed(v.averageDeltaKcal as number)} kcal` : ""}.` : "."));
  } else if (which !== "protein" && !cal) out.push(`${scope}: chưa có ngày nào đủ dữ liệu calo để tính trung bình.`);
  if (which !== "calories" && pro) {
    const v = pro.value;
    out.push(`${which === "protein" ? scope + ", protein" : "Protein"} ghi nhận trung bình khoảng ${fmt(v.averageG as number)} g/ngày (tính trên ${v.daysUsed} ngày có protein)` +
      (v.targetG != null ? `; mục tiêu ${fmt(v.targetG as number)} g${v.averageDeltaG != null ? `, chênh ${signed(v.averageDeltaG as number)} g` : ""}.` : "."));
  } else if (which !== "calories" && !pro) out.push("Chưa có ngày nào ghi đủ protein để tính trung bình.");
  if (has(r, "NUTRITION_TARGET_CHANGED")) out.push("Mục tiêu dinh dưỡng đã thay đổi trong khoảng này, nên không thể so toàn bộ khoảng với mục tiêu hiện tại như thể nó không đổi.");
  return out;
}

export function limitationLines(r: ProgressReviewV0): string[] {
  const out: string[] = [];
  if (has(r, "NO_TARGET_DEADLINE")) out.push(NO_DEADLINE);
  if (has(r, "BODY_PROFILE_FALLBACK")) out.push("Lưu ý: chưa có số đo InBody, nên mình dùng cân nặng bạn khai trong hồ sơ.");
  return out;
}

export function renderProgressReview(r: ProgressReviewV0, cls: ProgressQuestionClass, question: string, days = 28): string {
  const s = normalizeAgentText(question);
  switch (cls) {
    case "GAP": {
      const gap = find(r, "GAP_TO_TARGET");
      if (!gap) {
        if (has(r, "NO_TARGET")) return "Bạn chưa đặt cân nặng mục tiêu nên mình chưa tính được chênh lệch.";
        if (r.domains.BODY.state === "ERROR" || r.domains.BODY.state === "ABSENT") return "Mình chưa đọc được dữ liệu cân nặng lúc này nên chưa tính được chênh lệch. Bạn thử lại sau giây lát nhé.";
        return "Mình chưa có cân nặng hiện tại (chưa có số đo InBody hay cân nặng trong hồ sơ) nên chưa tính được chênh lệch.";
      }
      const lines = bodyLines(r);
      return [...lines, ...limitationLines(r).filter((x) => x !== NO_DEADLINE)].join(" ");
    }
    case "LATEST_WEIGHT": {
      const latest = find(r, "LATEST_MEASURED_WEIGHT");
      if (!latest) return r.domains.BODY.state === "ERROR" || r.domains.BODY.state === "ABSENT"
        ? "Mình chưa đọc được dữ liệu InBody lúc này. Bạn thử lại sau giây lát nhé." : "Bạn chưa có số đo InBody nào để mình đọc lại.";
      const age = Number(latest.value.ageDays);
      const stale = r.domains.BODY.quality === "STALE" ? " (khá cũ, chưa có số đo mới trong khoảng quan sát)" : "";
      const prof = find(r, "GAP_TO_TARGET")?.value.alternateProfileKg;
      return `Cân nặng đo InBody gần nhất là ${fmt(latest.value.weightKg as number)} kg, cách đây khoảng ${fmt(age)} ngày${stale}.` +
        (latest.value.excludedFromTrend ? " Lần đo này bị đánh dấu là thay đổi quá nhanh nên không được dùng cho xu hướng." : "") +
        (prof != null ? ` Hồ sơ của bạn đang ghi ${fmt(prof as number)} kg.` : "");
    }
    case "DIRECTION": {
      const lines = bodyLines(r, { direction: true });
      return [...lines, "Đây chỉ là hướng thay đổi đo được, chưa phải đánh giá tiến độ theo hạn chót."].join(" ");
    }
    case "SCHEDULE": {
      const lines = bodyLines(r, { direction: true });
      return [NO_DEADLINE, ...(lines.length ? ["Điều mình quan sát được:", ...lines] : [])].join(" ");
    }
    case "NUTRITION_READBACK": {
      const which = /protein|\bdam\b/.test(s) ? "protein" : /calo|kcal/.test(s) ? "calories" : "both";
      return nutritionLines(r, days, which).join(" ");
    }
    default: {
      // HOLISTIC
      if (r.overallCoverage === "INSUFFICIENT") {
        const parts = (["BODY", "TRAINING", "NUTRITION"] as Domain[]).map((d) => domainUnavailableLine(r, d, d === "BODY" ? "Cân nặng" : d === "TRAINING" ? "Tập luyện" : "Ăn uống")).filter(Boolean);
        return `Hiện chưa đủ dữ liệu để đánh giá tiến triển của bạn. ${parts.join(" ")}`.trim();
      }
      const lines: string[] = [];
      if (r.domains.BODY.state !== "NOT_REQUESTED") lines.push(...bodyLines(r));
      if (r.domains.TRAINING.state !== "NOT_REQUESTED") lines.push(...trainingLines(r, days));
      if (r.domains.NUTRITION.state !== "NOT_REQUESTED") lines.push(...nutritionLines(r, days));
      lines.push(...limitationLines(r));
      lines.push("Đây là mô tả số liệu quan sát được; mình không kết luận nguyên nhân giữa ăn uống, tập luyện và thay đổi cơ thể.");
      return lines.join(" ");
    }
  }
}

// ── bounded narration (HOLISTIC only) ─────────────────────────────────────

const NarrationSchema = z.object({ summary: z.string().min(10).max(800) });

export function evidenceSnapshot(r: ProgressReviewV0): Record<string, unknown> {
  return {
    mucTieu: r.goal.type,
    phamVi: Object.fromEntries(Object.entries(r.domains).map(([k, v]) => [k, `${v.state}${v.quality ? `/${v.quality}` : ""}`])),
    bangChung: r.evidence.map((e) => ({ linh_vuc: e.domain, loai: e.kind, gia_tri: e.value, chat_luong: e.quality, nguon: e.provenance ?? null })),
    gioiHan: r.limitations.map((l) => l.code),
  };
}

function collectNumbers(o: unknown, out: Set<number>): void {
  if (typeof o === "number" && Number.isFinite(o)) { out.add(o); out.add(Math.abs(o)); out.add(Math.round(o)); out.add(Math.round(Math.abs(o))); out.add(Math.round(o * 10) / 10); }
  else if (typeof o === "string") (o.match(/\d+(?:\.\d+)?/g) ?? []).forEach((n) => out.add(Number(n)));
  else if (Array.isArray(o)) o.forEach((x) => collectNumbers(x, out));
  else if (o && typeof o === "object") Object.values(o as Record<string, unknown>).forEach((x) => collectNumbers(x, out));
}

export const CAUSAL_RAW = /(?<![\p{L}])(vì|bởi vì|nhờ|khiến|dẫn đến|dẫn tới|làm cho|là kết quả|nguyên nhân|do (việc|bạn|ăn|tập|calo|protein|chế độ|thâm hụt))(?![\p{L}])/iu;
export const PRESCRIPTIVE = /(\b(nen|hay|phai|khuyen|de xuat|goi y|nhac)\b.*\b(giam|tang|an|tap|bo|them|doi|dieu chinh|cat|han che)\b|\bcan (phai|giam|tang|dieu chinh|bo sung)\b|giam them|tang them|dieu chinh (calo|lich|thuc don)|\d+\s*kcal.*(moi ngay|\/ngay).*(giam|tang))/;
export const ON_TRACK_CLAIM = /(dung tien do|kip (han|tien do)|dung han|on track|on schedule|se dat (duoc )?muc tieu|dat muc tieu (vao|truoc|trong)|theo dung ke hoach)/;
export const NEG = /(khong|chua|chang|khong the)/;

/** The smallest bounded safety net: reject unsupported numbers and the known high-risk claim families. */
export function validateReviewNarration(text: string, r: ProgressReviewV0): { ok: boolean; reason?: string } {
  const norm = normalizeAgentText(text);
  if (/(plateau|chung lai)/.test(norm)) return { ok: false, reason: "plateau_claim" };
  if (/(giac ngu|\bngu\b|hrv|nhip tim|phuc hoi|stress|cang thang)/.test(norm)) return { ok: false, reason: "unsupported_domain" };
  if (/(skeletal|\bsmm\b|khoi luong co|co xuong|co bap|lean mass|nac)/.test(norm)) return { ok: false, reason: "muscle_mass_claim" };
  if (CAUSAL_RAW.test(text.toLowerCase())) return { ok: false, reason: "causal_claim" };
  if (PRESCRIPTIVE.test(norm)) return { ok: false, reason: "prescriptive_claim" };
  if (/(toi uu|ly tuong|hoan hao|xuat sac|dang tut hau)/.test(norm)) return { ok: false, reason: "evaluative_claim" };
  for (const sentence of norm.split(/[.!?\n]+/)) if (ON_TRACK_CLAIM.test(sentence) && !NEG.test(sentence)) return { ok: false, reason: "on_track_claim" };
  const fatTrend = find(r, "BODY_FAT_TREND");
  if (/(giam mo|mat mo|fat loss|dot mo)/.test(norm) && fatTrend?.value.direction !== "DOWN") return { ok: false, reason: "fat_loss_claim_unsupported" };
  const allowed = new Set<number>();
  collectNumbers(evidenceSnapshot(r), allowed);
  collectNumbers(r.limitations, allowed);
  for (const m of norm.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (!allowed.has(n) && !allowed.has(Math.round(n))) return { ok: false, reason: "number_not_in_evidence" };
  }
  return { ok: true };
}

export const progressReviewDeps = {
  narrate: async (r: ProgressReviewV0, userId: string): Promise<string | null> => {
    const prompt = [
      "Bạn là huấn luyện viên. Viết 2–4 câu tiếng Việt tóm tắt tiến triển của người dùng từ BẰNG CHỨNG JSON dưới đây.",
      "Chỉ dùng các con số có trong JSON; không tự tính, không thêm số mới, không dự đoán ngày đạt mục tiêu.",
      "Chỉ MÔ TẢ số liệu: không nêu nguyên nhân (không dùng 'vì', 'nhờ', 'khiến'), không khuyên thay đổi calo/lịch tập, không đánh giá 'tối ưu'.",
      "Không nói về cơ bắp/khối lượng cơ, giấc ngủ, hay plateau. Nếu thiếu dữ liệu ở một lĩnh vực, nói rõ là chưa đánh giá được.",
      "Không nói 'đúng tiến độ'. Hướng 'TOWARD_TARGET' chỉ được diễn đạt là 'đang di chuyển theo hướng mục tiêu'.",
      'Trả về JSON: {"summary":"..."}',
      JSON.stringify(evidenceSnapshot(r)),
    ].join("\n");
    const out = await callLlmJson(prompt, NarrationSchema, {
      userId, phase: "progress-review-narration", numPredict: 260, attempts: NARRATION_BUDGET.attempts,
      timeoutMs: NARRATION_BUDGET.timeoutMs, purpose: "RECOMMENDATION_NARRATION", redactErrorDetail: true, logPrefix: "[progress-review]",
    });
    return out?.summary ?? null;
  },
};

// ── entry point used by readState("PROGRESS_REVIEW") ─────────────────────

export interface ProgressAnswer { text: string; source: string; facts: Record<string, unknown> }

export async function answerProgressReview(identity: AgentIdentity, question: string): Promise<ProgressAnswer> {
  const started = Date.now();
  const cls = classifyProgressReviewQuestion(question) ?? "HOLISTIC";
  const need = slicesFor(cls);
  const reads = await readCoachStateSlices(identity, {
    includeTraining: need.training, includeNutrition: need.nutrition, includeBodyGoal: need.bodyGoal,
  });
  const review = buildProgressReviewV0({ asOf: new Date(), training: toSlice(reads.training), nutrition: toSlice(reads.nutrition), bodyGoal: toSlice(reads.bodyGoal) });
  let text = renderProgressReview(review, cls, question);
  let llmCalls = 0;
  let usedNarration = false;
  let fallbackUsed = false;

  if (cls === "HOLISTIC" && review.overallCoverage !== "INSUFFICIENT" && unifiedCoachMode() === "on") {
    llmCalls = 1;
    const narrated = await progressReviewDeps.narrate(review, identity.userId).catch(() => null);
    if (narrated && validateReviewNarration(narrated, review).ok) {
      usedNarration = true;
      // code-appended facts the model must not be able to omit: unavailable/no-data domains, deadline, provenance
      const tail = [
        ...(["BODY", "TRAINING", "NUTRITION"] as Domain[])
          .filter((d) => ["ERROR", "ABSENT", "NO_DATA", "STALE"].includes(review.domains[d].state))
          .map((d) => domainUnavailableLine(review, d, d === "BODY" ? "Cân nặng" : d === "TRAINING" ? "Tập luyện" : "Ăn uống"))
          .filter((x): x is string => !!x),
        ...(has(review, "NUTRITION_TARGET_CHANGED") ? ["Mục tiêu dinh dưỡng đã thay đổi trong khoảng này nên số trung bình không so được trực tiếp với mục tiêu hiện tại."] : []),
        ...limitationLines(review),
      ];
      text = [narrated.trim(), ...tail].join(" ");
    } else fallbackUsed = true;
  }

  // Privacy: states/qualities/counters only — no weights, intake values, notes or prompt.
  logger.info({
    event: "progress_review_answer", answerClass: cls,
    domainsAvailable: (Object.keys(review.domains) as Domain[]).filter((d) => review.domains[d].state === "OK").length,
    domainsMissing: (Object.keys(review.domains) as Domain[]).filter((d) => ["NO_DATA", "STALE"].includes(review.domains[d].state)).length,
    domainsErrored: (Object.keys(review.domains) as Domain[]).filter((d) => ["ERROR", "ABSENT"].includes(review.domains[d].state)).length,
    bodyQuality: review.domains.BODY.quality, trainingQuality: review.domains.TRAINING.quality, nutritionQuality: review.domains.NUTRITION.quality,
    overallCoverage: review.overallCoverage, usedNarration, llmCalls, fallbackUsed, latencyMs: Date.now() - started,
  }, "progress_review_answer");

  return {
    text, source: "fitness-service:coach-state-slices",
    facts: { answerClass: cls, llmCalls, usedNarration, fallbackUsed, overallCoverage: review.overallCoverage, domains: review.domains },
  };
}
