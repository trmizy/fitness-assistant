/**
 * OBSIDIAN dashboard — InBody segmental data on an anatomical figure. Pure helpers (tested), no React.
 *
 * What the data IS (user-service InBodyEntry): lean mass and fat mass in kg for five segments —
 * right arm, left arm, trunk, right leg, left leg — each optional (older/manual sheets have none).
 * Left/right are the PERSON's sides (InBody convention), which is also body-muscles' convention
 * (verified on the installed package: FRONT `biceps-left` sits at x≈27.6 of 35 = the viewer's right;
 * BACK `triceps-long-left` at x≈43.6 of 37..72 = the viewer's left).
 *
 * What it is NOT: a per-muscle development score. Segment kg are never turned into "% developed", never coloured
 * good/bad, never compared across segments (an arm is not "weaker" than a leg). The only judgements shown are the
 * ones the product already owns: left/right balance (ai-service LIMB_ASYMMETRY via body-balance.utils) and the D4
 * body-composition verdicts on the whole-body numbers.
 */
import { MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS } from "../constants/muscleRegionMap";

export type SegmentKey = "rightArm" | "leftArm" | "trunk" | "rightLeg" | "leftLeg";
export type SegmentMetric = "lean" | "fat";

export const SEGMENTS: Array<{ key: SegmentKey; label: string; side: "right" | "left" | "central" }> = [
  { key: "rightArm", label: "Tay phải", side: "right" },
  { key: "leftArm", label: "Tay trái", side: "left" },
  { key: "trunk", label: "Thân", side: "central" },
  { key: "rightLeg", label: "Chân phải", side: "right" },
  { key: "leftLeg", label: "Chân trái", side: "left" },
];

const FIELD: Record<SegmentMetric, Record<SegmentKey, string>> = {
  lean: { rightArm: "rightArmMuscle", leftArm: "leftArmMuscle", trunk: "trunkMuscle", rightLeg: "rightLegMuscle", leftLeg: "leftLegMuscle" },
  fat: { rightArm: "rightArmFat", leftArm: "leftArmFat", trunk: "trunkFat", rightLeg: "rightLegFat", leftLeg: "leftLegFat" },
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const one = (n: number) => Math.round(n * 10) / 10;

export type SegmentValue = { key: SegmentKey; label: string; kg: number | null; prevKg: number | null; deltaKg: number | null };

/** Values for one metric; `prev` is the previous sheet (for "so với lần đo trước"), or null. */
export function segmentValues(entry: Record<string, unknown> | null | undefined, metric: SegmentMetric, prev?: Record<string, unknown> | null): SegmentValue[] {
  return SEGMENTS.map((s) => {
    const kg = entry ? num(entry[FIELD[metric][s.key]]) : null;
    const prevKg = prev ? num(prev[FIELD[metric][s.key]]) : null;
    return { key: s.key, label: s.label, kg, prevKg, deltaKg: kg != null && prevKg != null ? one(kg - prevKg) : null };
  });
}

/** Which metrics this sheet can show at all (a tab is offered only when at least one segment has a value). */
export function availableMetrics(entry: Record<string, unknown> | null | undefined): SegmentMetric[] {
  return (["lean", "fat"] as SegmentMetric[]).filter((m) => segmentValues(entry, m).some((v) => v.kg != null));
}

/**
 * Left/right balance for a pair, same rule + wording family as body-balance.utils (ai-service LIMB_ASYMMETRY_*:
 * < 5 % normal, 5–10 % mild, >= 10 % clear). Lean only: fat asymmetry has no product rule, so it is not judged.
 */
export function limbBalance(right: number | null, left: number | null): { diffPct: number; weaker: "trái" | "phải" | null; label: string; tone: "normal" | "mild" | "clear" } | null {
  if (right == null || left == null) return null;
  const diffPct = one((Math.abs(right - left) / Math.max(right, left)) * 100);
  const weaker = right === left ? null : left < right ? "trái" : "phải";
  if (diffPct < 5) return { diffPct, weaker, label: `Cân bằng · lệch ${diffPct.toLocaleString("vi-VN")}%`, tone: "normal" };
  const t = diffPct < 10 ? "mild" : "clear";
  return { diffPct, weaker, label: `${t === "mild" ? "Lệch nhẹ" : "Lệch rõ"} · bên ${weaker} ít hơn ${diffPct.toLocaleString("vi-VN")}%`, tone: t };
}

/* ── Figure: body-muscles region id → InBody segment ─────────────────────────────────────────────────
   Region boundaries follow the anatomical limbs (upper limb includes the deltoid; lower limb includes the gluteal
   region and hip flexors). The figure is an illustration of WHERE a segment is, the number is the machine's. */
const ARM = /^(shoulder-front|shoulder-side|deltoid-rear|biceps|triceps-long|triceps-lateral|forearm|forearm-flexors|forearm-extensors|elbow|hand|hand-back)-(left|right)$/;
const LEG = /^(hip-flexor|quads|adductors|tibialis-anterior|knee|knee-back|foot|foot-back|hamstrings-medial|hamstrings-lateral|calves-gastroc-medial|calves-gastroc-lateral|calves-soleus|gluteus-medius|gluteus-maximus)-(left|right)$/;
const TRUNK = /^(chest-upper|chest-lower|abs-upper|abs-lower|serratus-anterior|obliques|traps-upper|traps-mid|traps-lower|lats-upper|lats-mid|lats-lower|lower-back-erectors|lower-back-ql)-(left|right)$|^spine$/;

export function regionSegment(regionId: string): SegmentKey | null {
  let m = ARM.exec(regionId);
  if (m) return m[2] === "left" ? "leftArm" : "rightArm";
  m = LEG.exec(regionId);
  if (m) return m[2] === "left" ? "leftLeg" : "rightLeg";
  if (TRUNK.test(regionId)) return "trunk";
  return null; // head, face, neck, nape: shown, not a segment
}

/* ── Anatomy layer (neutral, not personal data): one Gymini Muscle.code per figure region ─────────── */
export const ANATOMY_CODES = [
  "chest", "front_delts", "side_delts", "biceps", "forearms", "abs", "obliques", "hip_flexors", "quads", "adductors",
  "rear_delts", "triceps", "traps", "lats", "spinal_erectors", "glutes", "hamstrings", "calves",
] as const;

let regionToCode: Map<string, string> | null = null;
export function regionAnatomyCode(regionId: string): string | null {
  if (!regionToCode) {
    regionToCode = new Map();
    for (const code of ANATOMY_CODES) for (const r of MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS[code] ?? []) if (!regionToCode.has(r)) regionToCode.set(r, code);
  }
  return regionToCode.get(regionId) ?? null;
}

export function fmtKg(v: number | null | undefined, digits = 1): string | null {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : null;
}
