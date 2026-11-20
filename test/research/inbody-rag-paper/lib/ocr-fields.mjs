export const SCALAR = ["measurement_date", "weight", "height", "skeletal_muscle_mass", "body_fat_mass", "percent_body_fat", "fat_free_mass", "basal_metabolic_rate", "visceral_fat_level"];
export const SEGS = ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"];
export function flatten(o) {
  if (!o) return null;
  const f = {};
  for (const k of SCALAR) f[k] = o[k] ?? null;
  for (const s of SEGS) { f[`lean_${s}`] = o.segmental_lean_analysis?.[s] ?? null; f[`fat_${s}`] = o.segmental_fat_analysis?.[s] ?? null; }
  return f;
}
export const FIELDS = [...SCALAR, ...SEGS.map((s) => `lean_${s}`), ...SEGS.map((s) => `fat_${s}`)];
