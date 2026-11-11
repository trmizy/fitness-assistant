/**
 * Maps the free-text exercise names used by recommendation_engine.ts's templates (and chat) onto real
 * catalog exercises.
 *
 * 2026-10-25 live incident: the old resolver searched the catalog by text (the search also matches the
 * exercise INSTRUCTIONS) and, with no exact-name hit, took the SHORTEST name among the results. Against the
 * real 884-exercise catalog that turned "Bench Press" into "JM Press", "Deadlift" into "Rack Pulls" and
 * "Barbell Row" into "Upright Barbell Row" (a shoulder exercise) — and saved the wrong plan.
 *
 * Now: (1) a verified canonical table for the template names, whose targets were each confirmed to exist in
 * the catalog; (2) for any other name, a candidate must contain every word of the query IN ITS NAME
 * (instruction-only matches are rejected), exact name first, then the shortest name that does.
 */
export const CANONICAL_EXERCISE_NAMES: Readonly<Record<string, string>> = {
  "bench press": "Barbell Bench Press - Medium Grip",
  "back squat": "Barbell Squat",
  "deadlift": "Barbell Deadlift",
  "barbell row": "Bent Over Barbell Row",
  "overhead press": "Standing Military Press",
  "incline barbell press": "Barbell Incline Bench Press - Medium Grip",
  "pec deck": "Butterfly",
  "cable fly": "Cable Crossover",
  "ab wheel rollout": "Ab Roller",
  "single arm dumbbell row": "One-Arm Dumbbell Row",
  "walking lunges": "Barbell Walking Lunge",
  "triceps dips": "Dips - Triceps Version",
  "pull-ups": "Pullups",
  "push-up": "Pushups",
  "rear delt fly": "Reverse Flyes",
  "calf raise": "Standing Calf Raises",
  "standing calf raise": "Standing Calf Raises",
  "lateral raise": "Side Lateral Raise",
  "cable lateral raise": "Cable Seated Lateral Raise",
  "hammer curl": "Hammer Curls",
  "leg curl": "Lying Leg Curls",
  "leg extension": "Leg Extensions",
  "lat pulldown": "Wide-Grip Lat Pulldown",
  "seated cable row": "Seated Cable Rows",
  "arnold press": "Arnold Dumbbell Press",
  "hip thrust": "Barbell Hip Thrust",
  "overhead triceps extension": "Cable Rope Overhead Triceps Extension",
  "reverse curl": "Reverse Barbell Curl",
  "straight arm pulldown": "Straight-Arm Pulldown",
  "cable curl": "Standing Biceps Cable Curl",
};

export interface NamedExercise { id: string; exerciseName: string }

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export function canonicalExerciseName(term: string): string | null {
  return CANONICAL_EXERCISE_NAMES[term.trim().toLowerCase()] ?? null;
}

/** Name-only pick: exact name, else the shortest name containing every query word; null when no NAME matches. */
export function pickExerciseByName<T extends NamedExercise>(exercises: T[], term: string): T | null {
  const wanted = normalize(term);
  if (!wanted) return null;
  const exact = exercises.find((e) => normalize(e.exerciseName) === wanted);
  if (exact) return exact;
  const words = wanted.split(" ").map(singular);
  const named = exercises.filter((e) => {
    const have = normalize(e.exerciseName).split(" ").map(singular);
    return words.every((w) => have.includes(w));
  });
  if (!named.length) return null;
  return [...named].sort((a, b) => a.exerciseName.length - b.exerciseName.length)[0];
}
