/**
 * Gate 6 (exercise/anatomy data-expansion roadmap) — maps this app's
 * canonical Muscle.code taxonomy (29 entries, seeded from
 * data/catalog/taxonomy/ref_muscles.csv, served by
 * GET /exercises/muscles) onto body-muscles' own region-id vocabulary
 * (verified directly against the installed package's
 * dist/data/muscle-groups.js — not assumed/guessed).
 *
 * Every code maps to BOTH left+right region ids where body-muscles
 * distinguishes sides — this app's exercise-muscle data has no
 * laterality of its own (a "biceps" mapping applies to both arms unless
 * the exercise is explicitly unilateral, which isn't tracked at this
 * granularity), so both sides are always highlighted together.
 *
 * Codes with NO entry here are deliberately left unmapped — no
 * body-muscles region corresponds closely enough to force a mapping
 * without guessing (abductors, transverse_abs, rotator_cuff — no
 * distinct region in the library) or the code isn't a physical region at
 * all (cardiovascular, mobility). The muscle-map UI must render these as
 * an explicit "no visual mapping available" state, never silently drop
 * them or guess a nearby region.
 */
export const MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS: Record<string, string[]> = {
  chest: ["chest-upper-left", "chest-upper-right", "chest-lower-left", "chest-lower-right"],
  upper_chest: ["chest-upper-left", "chest-upper-right"],
  mid_chest: ["chest-upper-left", "chest-upper-right", "chest-lower-left", "chest-lower-right"],
  lower_chest: ["chest-lower-left", "chest-lower-right"],
  front_delts: ["shoulder-front-left", "shoulder-front-right"],
  side_delts: ["shoulder-side-left", "shoulder-side-right"],
  rear_delts: ["deltoid-rear-left", "deltoid-rear-right"],
  triceps: ["triceps-long-left", "triceps-lateral-left", "triceps-long-right", "triceps-lateral-right"],
  biceps: ["biceps-left", "biceps-right"],
  forearms: ["forearm-left", "forearm-right"],
  lats: ["lats-upper-left", "lats-mid-left", "lats-lower-left", "lats-upper-right", "lats-mid-right", "lats-lower-right"],
  upper_back: ["traps-upper-left", "traps-upper-right", "lats-upper-left", "lats-upper-right"],
  mid_back: ["lats-mid-left", "lats-mid-right"],
  traps: ["traps-upper-left", "traps-mid-left", "traps-lower-left", "traps-upper-right", "traps-mid-right", "traps-lower-right"],
  spinal_erectors: ["lower-back-erectors-left", "lower-back-erectors-right"],
  abs: ["abs-upper-left", "abs-upper-right", "abs-lower-left", "abs-lower-right"],
  obliques: ["obliques-left", "obliques-right"],
  glutes: ["gluteus-medius-left", "gluteus-maximus-left", "gluteus-medius-right", "gluteus-maximus-right"],
  quads: ["quads-left", "quads-right"],
  hamstrings: ["hamstrings-medial-left", "hamstrings-lateral-left", "hamstrings-medial-right", "hamstrings-lateral-right"],
  adductors: ["adductors-left", "adductors-right"],
  calves: [
    "calves-gastroc-medial-left",
    "calves-gastroc-lateral-left",
    "calves-soleus-left",
    "calves-gastroc-medial-right",
    "calves-gastroc-lateral-right",
    "calves-soleus-right",
  ],
  hip_flexors: ["hip-flexor-left", "hip-flexor-right"],
  core: ["abs-upper-left", "abs-upper-right", "abs-lower-left", "abs-lower-right", "obliques-left", "obliques-right"],
  // Deliberately absent (no entry = no visual region, reported explicitly
  // by the component, never guessed): abductors, transverse_abs,
  // rotator_cuff, cardiovascular, mobility.
};

/** Which body-muscles regions belong to the BACK view vs FRONT view, so
 * the UI can auto-select a sensible default view for a given muscle (or
 * offer both when a muscle's regions span both views, e.g. shoulders). */
const BACK_VIEW_MUSCLE_CODES = new Set([
  "rear_delts",
  "traps",
  "upper_back",
  "mid_back",
  "lats",
  "spinal_erectors",
  "glutes",
  "hamstrings",
]);

export function isBackViewMuscle(code: string): boolean {
  return BACK_VIEW_MUSCLE_CODES.has(code);
}
