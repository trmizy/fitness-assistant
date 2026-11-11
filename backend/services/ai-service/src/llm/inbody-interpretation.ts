/**
 * InBody interpretation — the deterministic half of "Giải thích thể trạng" (docs/ai-product/inbody-interpretation-design.md).
 *
 * Turns one InBody entry (+ the previous one) into labelled facts a beginner can understand. The model only WRITES the
 * explanation from these facts; it never decides a status, invents a number or diagnoses. Pure: no I/O, no LLM.
 *
 * Every value carries its provenance: MEASURED (printed on the report / user-entered), COMPUTED (exact arithmetic on measured
 * values, e.g. FFMI), never a forecast. Thresholds are shared with plan generation (body_composition_rules.ts) or cited below.
 */
import { BF_HIGH_F, BF_HIGH_M, BF_OBESE_F, BF_OBESE_M, LIMB_ASYMMETRY_MILD_PCT, LIMB_ASYMMETRY_SIGNIFICANT_PCT } from "./body_composition_rules";

export interface InBodyEntryInput {
  id?: string;
  date?: string;
  weight?: number | null;
  height?: number | null;
  bodyFat?: number | null; // fat mass, kg
  bodyFatPct?: number | null;
  muscleMass?: number | null; // skeletal muscle mass, kg
  visceralFat?: number | null; // InBody visceral fat level
  bmr?: number | null;
  rightArmMuscle?: number | null; leftArmMuscle?: number | null; trunkMuscle?: number | null; rightLegMuscle?: number | null; leftLegMuscle?: number | null;
}
export interface TraineeInput { age?: number | null; gender?: string | null; heightCm?: number | null; goal?: string | null }

export type MetricStatus = "low" | "good" | "slightly_high" | "high" | "info";
export interface MetricFact { key: string; labelVi: string; value: number; unit: string; source: "MEASURED" | "COMPUTED"; status: MetricStatus; statusVi: string; noteVi?: string }
export interface ChangeFact { key: string; labelVi: string; from: number; to: number; delta: number; unit: string; meaningful: boolean }
export interface FlagFact { code: string; messageVi: string }
export interface InBodyInterpretation {
  measuredAt: string | null;
  daysSincePrevious: number | null;
  metrics: MetricFact[];
  bodyType: { code: "C" | "I" | "D"; labelVi: string; explanationVi: string } | null;
  balance: Array<{ partVi: string; leftKg: number; rightKg: number; diffPct: number; status: "normal" | "mild" | "significant" }>;
  changes: ChangeFact[];
  flags: FlagFact[];
  dataQuality: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);
const female = (g?: string | null) => /^f|nu|nữ/i.test(String(g ?? ""));

/** Noise thresholds between two scans (BIA day-to-day variation, hydration; Looney 2024, ESPEN). Below these a change is not called real. */
export const CHANGE_NOISE = { weight: 0.5, bodyFatPct: 1.0, muscleMass: 0.5, bodyFat: 0.5 } as const;
/** AWGS 2019 low-muscle cutoffs by BIA, kg/m² (appendicular lean / height²). Used only as a "worth checking" flag from age 40. */
export const ASMI_CHECK = { male: 7.0, female: 5.7 } as const;
/** InBody: visceral fat level under 10 recommended (InBody result-sheet guidance). */
export const VISCERAL_HIGH = 10;
/** FFMI medians, Schutz 2002 (young adults): men 18.9, women 15.4 kg/m². ±1.5 is used as a coarse "lower / higher than typical" band. */
export const FFMI_MEDIAN = { male: 18.9, female: 15.4 } as const;

function bodyFatStatus(pct: number, isFemale: boolean): { status: MetricStatus; statusVi: string } {
  const [low, high, obese] = isFemale ? [15, BF_HIGH_F, BF_OBESE_F] : [8, BF_HIGH_M, BF_OBESE_M];
  if (pct < low) return { status: "low", statusVi: "thấp hơn mức khuyến nghị" };
  if (pct < high) return { status: "good", statusVi: "trong khoảng tốt" };
  if (pct < obese) return { status: "slightly_high", statusVi: "hơi cao" };
  return { status: "high", statusVi: "cao" };
}

export function interpretInBody(latest: InBodyEntryInput, previous: InBodyEntryInput | null, trainee: TraineeInput): InBodyInterpretation {
  const isFemale = female(trainee.gender);
  const weight = n(latest.weight);
  const heightCm = n(latest.height) ?? n(trainee.heightCm);
  const fatKg = n(latest.bodyFat);
  const pct = n(latest.bodyFatPct) ?? (weight && fatKg ? r1((fatKg / weight) * 100) : null);
  const smm = n(latest.muscleMass);
  const out: InBodyInterpretation = { measuredAt: latest.date ?? null, daysSincePrevious: null, metrics: [], bodyType: null, balance: [], changes: [], flags: [], dataQuality: [] };

  if (weight) out.metrics.push({ key: "weight", labelVi: "Cân nặng", value: r1(weight), unit: "kg", source: "MEASURED", status: "info", statusVi: "" });
  let fatStatus: MetricStatus | null = null;
  if (pct) {
    const s = bodyFatStatus(pct, isFemale); fatStatus = s.status;
    out.metrics.push({ key: "bodyFatPct", labelVi: "Tỷ lệ mỡ cơ thể", value: r1(pct), unit: "%", source: "MEASURED", ...s,
      noteVi: `Máy InBody ước tính mỡ bằng dòng điện yếu (BIA); có thể lệch khoảng 3 điểm % so với phương pháp chuẩn.` });
  }
  if (smm) out.metrics.push({ key: "muscleMass", labelVi: "Khối cơ xương", value: r1(smm), unit: "kg", source: "MEASURED", status: "info", statusVi: "",
    noteVi: "Khối lượng các cơ bám vào xương (cơ dùng để vận động) — không phải khối lượng xương." });

  let muscleLevel: "low" | "typical" | "high" | null = null;
  if (weight && fatKg && heightCm) {
    const ffmi = r1((weight - fatKg) / (heightCm / 100) ** 2);
    const median = isFemale ? FFMI_MEDIAN.female : FFMI_MEDIAN.male;
    muscleLevel = ffmi < median - 1.5 ? "low" : ffmi > median + 1.5 ? "high" : "typical";
    out.metrics.push({ key: "ffmi", labelVi: "Chỉ số khối không mỡ (FFMI)", value: ffmi, unit: "kg/m²", source: "COMPUTED",
      status: muscleLevel === "low" ? "low" : "info",
      statusVi: muscleLevel === "low" ? "thấp hơn mức thường gặp" : muscleLevel === "high" ? "cao hơn mức thường gặp" : "ở mức thường gặp",
      noteVi: `Tính từ (cân nặng − khối mỡ) / chiều cao²; mức thường gặp ở người trẻ khoảng ${median} kg/m².` });
  }
  const visceral = n(latest.visceralFat);
  if (visceral) {
    out.metrics.push({ key: "visceralFat", labelVi: "Mỡ nội tạng (mức)", value: r1(visceral), unit: "", source: "MEASURED",
      status: visceral >= VISCERAL_HIGH ? "high" : "good", statusVi: visceral >= VISCERAL_HIGH ? "cao hơn mức khuyến nghị (dưới 10)" : "trong mức khuyến nghị (dưới 10)" });
    if (visceral >= VISCERAL_HIGH) out.flags.push({ code: "VISCERAL_HIGH", messageVi: "Mỡ nội tạng từ mức 10 trở lên liên quan đến nguy cơ tim mạch – chuyển hoá; nên kiểm tra sức khoẻ định kỳ với bác sĩ." });
  }
  const bmr = n(latest.bmr);
  if (bmr) out.metrics.push({ key: "bmr", labelVi: "Năng lượng nghỉ (BMR)", value: Math.round(bmr), unit: "kcal/ngày", source: "MEASURED", status: "info", statusVi: "",
    noteVi: "Đây là năng lượng cơ thể dùng khi nghỉ hoàn toàn, chưa tính vận động — không phải mục tiêu ăn mỗi ngày." });

  // Muscle–fat type, after InBody's C/I/D idea, from the two levels above (heuristic, labelled as such in the copy).
  if (fatStatus && muscleLevel) {
    const fatHigh = fatStatus === "slightly_high" || fatStatus === "high";
    if (fatHigh && muscleLevel !== "high") out.bodyType = { code: "C", labelVi: "Mỡ nhiều hơn so với cơ", explanationVi: "Lượng mỡ cao so với lượng cơ. Hướng phù hợp: giảm mỡ từ từ và tăng cơ bằng tập kháng lực." };
    else if (muscleLevel === "high" && !fatHigh) out.bodyType = { code: "D", labelVi: "Nhiều cơ, mỡ trong khoảng tốt", explanationVi: "Lượng cơ nổi trội và mỡ không cao — dáng thể thao. Hướng phù hợp: duy trì và tiếp tục tập có tiến độ." };
    else out.bodyType = { code: "I", labelVi: "Cơ và mỡ tương đối cân đối", explanationVi: fatHigh ? "Cơ và mỡ cân đối nhưng mỡ vẫn hơi cao; giảm mỡ nhẹ sẽ cải thiện sức khoẻ." : "Cơ và mỡ cân đối. Hướng phù hợp: tăng cơ dần nếu muốn khoẻ và săn chắc hơn." };
  }

  // Left/right balance — same thresholds as plan generation.
  const pair = (partVi: string, l?: number | null, r?: number | null) => {
    const L = n(l), R = n(r); if (!L || !R) return;
    const diffPct = r1((Math.abs(L - R) / Math.max(L, R)) * 100);
    out.balance.push({ partVi, leftKg: r1(L), rightKg: r1(R), diffPct, status: diffPct >= LIMB_ASYMMETRY_SIGNIFICANT_PCT ? "significant" : diffPct >= LIMB_ASYMMETRY_MILD_PCT ? "mild" : "normal" });
  };
  pair("Tay", latest.leftArmMuscle, latest.rightArmMuscle);
  pair("Chân", latest.leftLegMuscle, latest.rightLegMuscle);

  // Appendicular lean index: a "worth checking" flag only, never a diagnosis (AWGS 2019; InBody reads lower than other devices).
  const limbs = [latest.leftArmMuscle, latest.rightArmMuscle, latest.leftLegMuscle, latest.rightLegMuscle].map(n);
  if (heightCm && limbs.every((x) => x) && typeof trainee.age === "number" && trainee.age >= 40) {
    const asmi = r1((limbs as number[]).reduce((a, b) => a + b, 0) / (heightCm / 100) ** 2);
    const cut = isFemale ? ASMI_CHECK.female : ASMI_CHECK.male;
    if (asmi < cut) out.flags.push({ code: "LOW_LIMB_MUSCLE_CHECK", messageVi: `Khối cơ tay chân so với chiều cao (${asmi} kg/m²) thấp hơn mốc tham khảo ${cut} kg/m². Đây không phải chẩn đoán; nếu thấy yếu sức hoặc hay mệt, nên hỏi bác sĩ để kiểm tra thêm sức cơ.` });
  }

  // Change since the previous scan, with a noise threshold.
  if (previous) {
    const days = latest.date && previous.date ? Math.round((Date.parse(latest.date) - Date.parse(previous.date)) / 86_400_000) : null;
    out.daysSincePrevious = days;
    const prevPct = n(previous.bodyFatPct) ?? (n(previous.weight) && n(previous.bodyFat) ? r1(((previous.bodyFat as number) / (previous.weight as number)) * 100) : null);
    const add = (key: keyof typeof CHANGE_NOISE, labelVi: string, from: number | null, to: number | null, unit: string) => {
      if (from == null || to == null) return;
      const delta = r1(to - from);
      out.changes.push({ key, labelVi, from: r1(from), to: r1(to), delta, unit, meaningful: Math.abs(delta) >= CHANGE_NOISE[key] });
    };
    add("weight", "Cân nặng", n(previous.weight), weight, "kg");
    add("bodyFatPct", "Tỷ lệ mỡ", prevPct, pct, "điểm %");
    add("muscleMass", "Khối cơ xương", n(previous.muscleMass), smm, "kg");
    if (out.changes.length && out.changes.every((c) => !c.meaningful)) {
      out.dataQuality.push("Các thay đổi so với lần đo trước đều nhỏ hơn mức dao động thường gặp của máy — chưa nên kết luận là đã thay đổi.");
    }
    if (days != null && days < 14) out.dataQuality.push(`Hai lần đo chỉ cách nhau ${days} ngày; thành phần cơ thể thường cần vài tuần mới đổi rõ.`);
  } else {
    out.dataQuality.push("Đây là lần đo đầu tiên — lần đo sau sẽ cho biết xu hướng.");
  }
  out.dataQuality.push("Để so sánh chính xác: đo cùng giờ, buổi sáng, chưa ăn, chưa tập và không uống nhiều nước trước khi đo.");
  if (!pct || !smm) out.dataQuality.push("Phiếu thiếu một số chỉ số chính (tỷ lệ mỡ hoặc khối cơ), nên phần đánh giá chưa đầy đủ.");
  return out;
}
