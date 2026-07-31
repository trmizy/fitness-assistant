import type { InBodyEntrySnapshot } from "../clients/user.client";
import { cycleThresholds } from "../config/cycle-thresholds.config";

export interface InBodyOutlierFlag {
  entryId: string;
  reason: string;
}

export interface InBodyIntervalWarning {
  entryId: string;
  reason: string;
}

export interface InBodyTrendPoint {
  entryId: string;
  date: string;
  weight: number;
  bodyFatPct: number | null;
  muscleMass: number;
}

export interface InBodyQualityResult {
  recordCount: number;
  comparableRecordCount: number; // non-outlier records usable for trend
  hasSufficientData: boolean; // >= cycleThresholds.assessment.minimumComparableInBodyRecords
  outlierFlags: InBodyOutlierFlag[];
  intervalWarnings: InBodyIntervalWarning[];
  deviceConsistencyWarning: string | null;
  /** Always false today — InBodyEntry has no total-body-water/ECW field in
   * this schema, so the "large weight swing + large water swing → lower
   * confidence" rule from the spec cannot be evaluated. Documented no-op,
   * not a silently-skipped requirement — see README note at bottom of file. */
  weightWaterConflict: boolean;
  /** 0-1, multiplies into the Decision Engine's overall confidenceScore. */
  confidenceMultiplier: number;
  /** Human-readable audit strings, safe to surface in reasonCodes. */
  qualityFlags: string[];
  /** Comparable (non-outlier) points sorted oldest-first, for trend calc. */
  comparablePoints: InBodyTrendPoint[];
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

/**
 * Evaluates a set of InBody entries for a training cycle (from
 * CycleInBodyLink plus start/end snapshots) for data-quality issues before
 * any body-composition conclusion is drawn from them. Never drops/deletes
 * entries — only flags and down-weights, per the spec's explicit
 * "không xóa dữ liệu bất thường; chỉ đánh dấu và giảm trọng số" rule.
 */
export function evaluateInBodyQuality(entries: InBodyEntrySnapshot[]): InBodyQualityResult {
  const t = cycleThresholds.inbodyQuality;
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const outlierFlags: InBodyOutlierFlag[] = [];
  const intervalWarnings: InBodyIntervalWarning[] = [];
  const qualityFlags: string[] = [];
  const outlierIds = new Set<string>();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gapDays = daysBetween(prev.date, cur.date);

    if (gapDays > 0 && gapDays < t.minMeaningfulIntervalDays) {
      intervalWarnings.push({
        entryId: cur.id,
        reason: `Chỉ cách lần đo trước ${gapDays.toFixed(1)} ngày — dưới khoảng cách tối thiểu ${t.minMeaningfulIntervalDays} ngày để có giá trị xu hướng.`,
      });
    }

    if (gapDays > 0) {
      const weightRate = Math.abs(cur.weight - prev.weight) / gapDays;
      if (weightRate > t.maxPlausibleWeightChangeKgPerDay) {
        outlierFlags.push({
          entryId: cur.id,
          reason: `Cân nặng thay đổi ${(cur.weight - prev.weight).toFixed(1)}kg trong ${gapDays.toFixed(1)} ngày (${weightRate.toFixed(2)}kg/ngày) — vượt ngưỡng hợp lý ${t.maxPlausibleWeightChangeKgPerDay}kg/ngày; nhiều khả năng do nước/thời điểm ăn uống hơn là thay đổi mô thực sự.`,
        });
        outlierIds.add(cur.id);
      }

      if (
        cur.bodyFatPct != null &&
        prev.bodyFatPct != null &&
        Math.abs(cur.bodyFatPct - prev.bodyFatPct) > t.maxPlausibleBodyFatPctChange
      ) {
        outlierFlags.push({
          entryId: cur.id,
          reason: `Tỉ lệ mỡ cơ thể thay đổi ${(cur.bodyFatPct - prev.bodyFatPct).toFixed(1)}pp trong ${gapDays.toFixed(1)} ngày — vượt ngưỡng hợp lý ${t.maxPlausibleBodyFatPctChange}pp; nhiều khả năng do sai số điều kiện đo hơn là thay đổi thực sự.`,
        });
        outlierIds.add(cur.id);
      }
    }
  }

  // Device/measurement-method consistency — status ("manual"/"extracted") is
  // the closest proxy available in this schema to a real device/model field.
  const statuses = new Set(sorted.map((e) => e.status).filter((s): s is string => !!s));
  const deviceConsistencyWarning =
    statuses.size > 1
      ? `Các lần đo dùng nguồn khác nhau (${[...statuses].join(", ")}) — so sánh giữa các nguồn khác nhau kém tin cậy hơn so với cùng một nguồn.`
      : null;
  if (deviceConsistencyWarning) qualityFlags.push(deviceConsistencyWarning);

  const comparablePoints: InBodyTrendPoint[] = sorted
    .filter((e) => !outlierIds.has(e.id))
    .map((e) => ({
      entryId: e.id,
      date: e.date,
      weight: e.weight,
      bodyFatPct: e.bodyFatPct ?? null,
      muscleMass: e.muscleMass,
    }));

  const comparableRecordCount = comparablePoints.length;
  const hasSufficientData =
    comparableRecordCount >= cycleThresholds.assessment.minimumComparableInBodyRecords;

  if (sorted.length === 1) {
    qualityFlags.push(
      "Chỉ có 1 lần đo InBody trong chu kỳ này — không đủ để kết luận đáng tin cậy về thay đổi cơ/mỡ chỉ từ một điểm dữ liệu.",
    );
  }
  if (outlierFlags.length > 0) {
    qualityFlags.push(`${outlierFlags.length} lần đo bị đánh dấu là bất thường và bị loại khỏi tính toán xu hướng.`);
  }
  if (!hasSufficientData) {
    qualityFlags.push(
      `Chỉ có ${comparableRecordCount} lần đo có thể so sánh được — thấp hơn mức tối thiểu ${cycleThresholds.assessment.minimumComparableInBodyRecords} lần cần thiết để kết luận đáng tin cậy về xu hướng thể trạng.`,
    );
  }

  // Confidence multiplier: starts at 1, penalized for insufficient data,
  // outliers, and mixed measurement sources. Floors at 0.2 rather than 0 —
  // even weak InBody data shouldn't zero out an otherwise strong workout
  // signal in the Decision Engine.
  let confidenceMultiplier = 1;
  if (sorted.length === 0) confidenceMultiplier = 0;
  else if (sorted.length === 1) confidenceMultiplier = 0.3;
  else if (!hasSufficientData) confidenceMultiplier = 0.5;
  if (outlierFlags.length > 0) confidenceMultiplier *= 0.85;
  if (deviceConsistencyWarning) confidenceMultiplier *= 0.9;
  // Floor at 0.2 for "some data, just weak" — but zero records is a
  // categorically different case (no signal at all) and must stay 0, not
  // get floored up to a false minimum confidence.
  confidenceMultiplier =
    sorted.length === 0 ? 0 : Math.max(0.2, Math.min(1, confidenceMultiplier));

  return {
    recordCount: sorted.length,
    comparableRecordCount,
    hasSufficientData,
    outlierFlags,
    intervalWarnings,
    deviceConsistencyWarning,
    weightWaterConflict: false,
    confidenceMultiplier: Math.round(confidenceMultiplier * 100) / 100,
    qualityFlags,
    comparablePoints,
  };
}

// NOTE on weightWaterConflict: the spec asks to lower confidence when a
// large weight swing coincides with a large total-body-water swing (since
// that suggests hydration, not fat/muscle change, drove the weight delta).
// This repo's InBodyEntry (user-service) does not currently store total
// body water / ECW-TBW — only weight/bodyFat/muscleMass/visceralFat/bmr are
// exposed via InBodyEntrySnapshot. This function always returns false for
// that field rather than fabricating a signal from absent data; if TBW is
// added to InBodyEntry later, wire it in here.
