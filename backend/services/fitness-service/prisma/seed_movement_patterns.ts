/**
 * Gym-onboarding project follow-up — populates Exercise.movementPattern,
 * previously 100% NULL despite the column existing. This is a controlled,
 * small canonical taxonomy (not hundreds of free-text labels), classified
 * offline by this seeder script from exercise name + typeOfActivity + type
 * (PUSH/PULL/HOLD/STRETCH) + bodyPart — never re-derived from name at
 * runtime (see equipment-availability.util.ts's sibling design: runtime
 * code only ever reads the already-populated column).
 *
 * Two-tier classification, both tiers logged separately so the audit is
 * honest about precision:
 *   1. Name-regex rules — precise, e.g. "Barbell Squat" -> SQUAT.
 *   2. Fallback from typeOfActivity + type + bodyPart when no name rule
 *      matches — coarser but still a real biomechanical signal (not a
 *      random guess), e.g. an unmatched PUSH/UPPER_BODY exercise defaults
 *      to HORIZONTAL_PUSH.
 *
 * Idempotent: only ever sets movementPattern when it's currently NULL,
 * never overwrites a value a human curator may set later.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx prisma/seed_movement_patterns.ts
 */
import { PrismaClient } from "../src/generated/prisma";
// Canonical taxonomy lives in src/constants/movement-patterns.ts (imported
// by tests/validation, not needed here — the NAME_RULES below reference
// pattern strings directly).

const prisma = new PrismaClient();

// Ordered — first match wins. Checked against the lowercased exercise name.
const NAME_RULES: Array<[RegExp, string]> = [
  // Legs — check before arm/shoulder rules so e.g. "Leg Curl" never
  // accidentally matches a generic "curl" rule below.
  [/hip thrust|glute bridge/i, "HIP_EXTENSION"],
  [/deadlift|romanian|\brdl\b|good morning|hyperextension|back extension|glute.ham|reverse hyper/i, "HINGE"],
  [/lunge|step-?\s?ups?|split squat|bulgarian/i, "LUNGE"],
  [/leg press|hack squat|\bsquat\b/i, "SQUAT"],
  [/leg curl|hamstring curl|nordic/i, "KNEE_FLEXION"],
  [/leg extension/i, "KNEE_EXTENSION"],
  [/calf raise|calf press/i, "CALF_RAISE"],
  [/abduct|adduct|thigh abductor|thigh adductor|lateral band walk|clamshell/i, "HIP_ABDUCTION_ADDUCTION"],

  // Upper-body pulls
  [/pulldown|pull-?up|chin-?up|pullover/i, "VERTICAL_PULL"],
  [/\brow(s)?\b|face pull|rear delt|reverse fly|reverse flye/i, "HORIZONTAL_PULL"],
  [/shrug|lateral raise|front raise|deltoid raise|upright row|rotator cuff|internal rotation|external rotation/i, "SHOULDER_ISOLATION"],

  // Upper-body pushes — order matters: overhead/incline BEFORE flat/bench,
  // and both BEFORE the generic curl/triceps isolation rules below.
  [/overhead press|shoulder press|military press|push press|handstand push|incline.*press|arnold press/i, "VERTICAL_PUSH"],
  [/dip\b|dips\b/i, "VERTICAL_PUSH"],
  [/bench press|chest press|floor press|decline press|push-?up|chest fly|flye|pec deck|crossover|close-?grip.*press/i, "HORIZONTAL_PUSH"],

  // Arm isolation (after presses/rows/pulldowns above, so e.g. "EZ Bar
  // Skullcrusher" or "Cable Curl" never gets caught by a broader rule first)
  [/triceps? (extension|pushdown|kickback)|skullcrusher|kickback|jm press/i, "ELBOW_EXTENSION"],
  [/curls?\b/i, "ELBOW_FLEXION"], // biceps/forearm curls — leg/hamstring curls already matched above ("curls?" not "\bcurl\b" so plural "Curls" still matches)

  // Core
  [/crunch|sit-?up|leg raise|knee raise|v-up|toe touch|bicycle|air bike/i, "CORE_FLEXION"],
  [/russian twist|wood ?chop|torso rotation|oblique|side bend|windmill/i, "CORE_ROTATION"],
  [/plank|dead ?bug|pallof|ab (wheel|roller)|rollout|hollow hold/i, "CORE_ANTI_EXTENSION"],

  // Carries / locomotion (mostly relevant for STRENGTH_CARDIO/strongman
  // items that slipped past the typeOfActivity=CARDIO check below)
  [/farmer|loaded carry|suitcase carry|\bdrag\b|sled|atlas stone|\byoke\b|prowler/i, "CARRY"],
  [/sprint|shuttle|bear crawl|carioca/i, "LOCOMOTION"],
];

function classify(exercise: {
  exerciseName: string;
  typeOfActivity: string;
  type: string;
  bodyPart: string;
}): { pattern: string; tier: "name" | "fallback" } {
  if (exercise.typeOfActivity === "CARDIO") return { pattern: "CARDIO", tier: "name" };
  if (exercise.typeOfActivity === "MOBILITY") return { pattern: "MOBILITY", tier: "name" };

  const name = exercise.exerciseName;
  for (const [re, pattern] of NAME_RULES) {
    if (re.test(name)) return { pattern, tier: "name" };
  }

  // Fallback — coarse but principled: real push/pull + body-region signal,
  // not a random default.
  if (exercise.type === "STRETCH") return { pattern: "MOBILITY", tier: "fallback" };
  if (exercise.type === "HOLD") {
    return { pattern: exercise.bodyPart === "CORE" ? "CORE_ANTI_EXTENSION" : "OTHER", tier: "fallback" };
  }
  if (exercise.type === "PUSH") {
    return { pattern: exercise.bodyPart === "LOWER_BODY" ? "SQUAT" : "HORIZONTAL_PUSH", tier: "fallback" };
  }
  if (exercise.type === "PULL") {
    return { pattern: exercise.bodyPart === "LOWER_BODY" ? "HINGE" : "HORIZONTAL_PULL", tier: "fallback" };
  }
  return { pattern: "OTHER", tier: "fallback" };
}

async function main() {
  console.log("── Populating Exercise.movementPattern ──");
  const exercises = await prisma.exercise.findMany({
    where: { movementPattern: null },
    select: { id: true, exerciseName: true, typeOfActivity: true, type: true, bodyPart: true },
  });
  console.log(`Found ${exercises.length} exercises with no movementPattern set.`);

  let byName = 0;
  let byFallback = 0;
  const fallbackSamples: string[] = [];

  for (const ex of exercises) {
    const { pattern, tier } = classify(ex);
    await prisma.exercise.update({ where: { id: ex.id }, data: { movementPattern: pattern } });
    if (tier === "name") byName++;
    else {
      byFallback++;
      if (fallbackSamples.length < 20) fallbackSamples.push(`${ex.exerciseName} -> ${pattern}`);
    }
  }

  console.log(`Classified by precise name rule: ${byName}`);
  console.log(`Classified by type+bodyPart fallback: ${byFallback}`);
  if (fallbackSamples.length > 0) {
    console.log("Fallback sample (first 20):");
    for (const s of fallbackSamples) console.log(`  → ${s}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
