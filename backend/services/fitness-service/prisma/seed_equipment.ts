/**
 * Gym-onboarding project — normalized Equipment catalog + Exercise<->Equipment
 * mapping, built from the SAME raw dataset already seeded into `exercises`
 * (prisma/raw_exercises.json, free-exercise-db, 874 exercises) rather than
 * invented data. Also backfills Exercise.mechanics/movementPattern/
 * difficultyLevel, which were previously 100% NULL despite being present in
 * the raw JSON (mechanic/level) or cheaply derivable from it (movementPattern).
 *
 * Idempotent: Equipment rows are upserted by stable slug; ExerciseEquipment
 * rows are upserted by (exerciseId, equipmentId); re-running never
 * duplicates or drifts ids. Safe to run against a DB that already has
 * exercises seeded (the normal case) or an empty one (falls back to no-op
 * on the exercise-matching step, logged, not fatal).
 *
 * Run with (inside the fitness-service container):
 *   npx tsx prisma/seed_equipment.ts
 */
import { PrismaClient } from "../src/generated/prisma";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ─── 1. Canonical equipment catalog ─────────────────────────────────────────
// Every entry here is justified by an actual need surfaced while classifying
// the 874-exercise dataset (see CLASSIFY_MACHINE / CLASSIFY_OTHER below) —
// not a copy of an external wishlist. Categories loosely follow the grouping
// suggested in the onboarding spec, trimmed to what the data actually uses.
type EquipmentSeed = {
  slug: string;
  name: string;
  category: string;
  aliases?: string[];
  description?: string;
  // Hardening pass §14 — defaults to true (real, user-selectable equipment).
  // Set false only for internal bookkeeping rows that must exist as a valid
  // FK target for classification purposes but should never be offered to a
  // user, never satisfy a real equipment requirement, and never be
  // insertable as UserEquipment (equipmentService.setUserEquipment's
  // validation already rejects inactive ids — see equipment.repository.ts's
  // `active: true` filter).
  active?: boolean;
};

const EQUIPMENT_CATALOG: EquipmentSeed[] = [
  // Free weights
  { slug: "barbell", name: "Barbell", category: "FREE_WEIGHTS", aliases: ["bar bell", "olympic bar"] },
  { slug: "ez-curl-bar", name: "EZ Curl Bar", category: "FREE_WEIGHTS", aliases: ["e-z bar", "curl bar"] },
  { slug: "dumbbell", name: "Dumbbell", category: "FREE_WEIGHTS", aliases: ["dumbbells", "db", "free weight dumbbell"] },
  { slug: "kettlebell", name: "Kettlebell", category: "FREE_WEIGHTS", aliases: ["kettlebells", "kb"] },
  { slug: "medicine-ball", name: "Medicine Ball", category: "FREE_WEIGHTS", aliases: ["med ball"] },
  { slug: "exercise-ball", name: "Exercise / Stability Ball", category: "FREE_WEIGHTS", aliases: ["stability ball", "swiss ball"] },

  // Benches / racks
  { slug: "bench", name: "Bench (flat/incline/adjustable)", category: "BENCHES_RACKS", aliases: ["flat bench", "incline bench", "adjustable bench", "weight bench"] },
  { slug: "squat-rack", name: "Squat Rack / Power Rack", category: "BENCHES_RACKS", aliases: ["power rack", "rack", "cage"] },
  { slug: "smith-machine", name: "Smith Machine", category: "BENCHES_RACKS", aliases: ["smith"] },

  // Cable
  { slug: "cable-machine", name: "Cable Machine", category: "CABLE", aliases: ["cable", "cable stack", "functional cable", "pulley", "cable station", "cable crossover", "functional trainer"] },

  // Chest machines
  { slug: "chest-press-machine", name: "Chest Press Machine", category: "CHEST_MACHINES", aliases: ["machine chest press", "plate loaded chest press", "horizontal press machine"] },
  { slug: "pec-deck-machine", name: "Pec Deck / Chest Fly Machine", category: "CHEST_MACHINES", aliases: ["pec deck", "butterfly machine", "chest fly machine"] },

  // Back machines
  { slug: "lat-pulldown-machine", name: "Lat Pulldown Machine", category: "BACK_MACHINES", aliases: ["lat pulldown", "pulldown machine"] },
  { slug: "seated-row-machine", name: "Seated Row Machine", category: "BACK_MACHINES", aliases: ["row machine", "chest-supported row machine"] },
  { slug: "assisted-pullup-dip-machine", name: "Assisted Pull-Up / Dip Machine", category: "BACK_MACHINES", aliases: ["assisted pull-up machine", "assisted dip machine", "gravitron"] },

  // Shoulder machines
  { slug: "shoulder-press-machine", name: "Shoulder Press Machine", category: "SHOULDER_MACHINES", aliases: ["machine shoulder press"] },

  // Leg machines
  { slug: "leg-press-machine", name: "Leg Press", category: "LEG_MACHINES", aliases: ["leg press machine"] },
  { slug: "hack-squat-machine", name: "Hack Squat Machine", category: "LEG_MACHINES", aliases: ["hack squat"] },
  { slug: "leg-extension-machine", name: "Leg Extension Machine", category: "LEG_MACHINES", aliases: ["leg extension"] },
  { slug: "leg-curl-machine", name: "Leg Curl Machine", category: "LEG_MACHINES", aliases: ["leg curl", "lying leg curl", "seated leg curl"] },
  { slug: "hip-adduction-abduction-machine", name: "Hip Adductor/Abductor Machine", category: "LEG_MACHINES", aliases: ["hip abductor", "hip adductor", "inner/outer thigh machine"] },
  { slug: "glute-machine", name: "Glute Drive / Hip Thrust Machine", category: "LEG_MACHINES", aliases: ["hip thrust machine", "glute drive"] },
  { slug: "calf-raise-machine", name: "Calf Raise Machine", category: "LEG_MACHINES", aliases: ["seated calf raise machine", "standing calf raise machine"] },

  // Arm machines
  { slug: "bicep-curl-machine", name: "Biceps Curl Machine", category: "ARM_MACHINES", aliases: ["preacher curl machine"] },
  { slug: "tricep-extension-machine", name: "Triceps Extension Machine", category: "ARM_MACHINES", aliases: [] },
  { slug: "dip-machine", name: "Dip Machine", category: "ARM_MACHINES", aliases: [] },

  // Core machines
  { slug: "ab-crunch-machine", name: "Ab Crunch / Torso Rotation Machine", category: "CORE_MACHINES", aliases: ["abdominal machine", "rotary torso machine"] },

  // Cardio
  { slug: "treadmill", name: "Treadmill", category: "CARDIO", aliases: [] },
  { slug: "stationary-bike", name: "Stationary / Spin Bike", category: "CARDIO", aliases: ["spin bike", "recumbent bike"] },
  { slug: "rowing-machine", name: "Rowing Machine", category: "CARDIO", aliases: ["erg", "rower"] },
  { slug: "stair-climber", name: "Stair Climber", category: "CARDIO", aliases: ["stairmaster", "step mill"] },
  { slug: "elliptical", name: "Elliptical", category: "CARDIO", aliases: ["elliptical trainer"] },

  // Other
  { slug: "bodyweight", name: "Bodyweight (no equipment)", category: "OTHER", aliases: ["body only", "no equipment"] },
  { slug: "resistance-band", name: "Resistance Band", category: "OTHER", aliases: ["band", "bands"] },
  { slug: "foam-roller", name: "Foam Roller", category: "OTHER", aliases: ["foam roll"] },
  { slug: "pull-up-bar", name: "Pull-Up Bar", category: "OTHER", aliases: [] },
  { slug: "dip-bars", name: "Dip Bars / Parallel Bars", category: "OTHER", aliases: [] },
  { slug: "suspension-trainer", name: "Suspension Trainer (TRX)", category: "OTHER", aliases: ["trx"] },
  { slug: "battle-ropes", name: "Battle Ropes", category: "OTHER", aliases: ["battling ropes"] },
  { slug: "sled", name: "Sled", category: "OTHER", aliases: ["prowler"] },
  { slug: "jump-rope", name: "Jump Rope", category: "OTHER", aliases: ["rope jumping"] },
  { slug: "plyo-box", name: "Plyo Box", category: "OTHER", aliases: ["box"] },
  { slug: "specialty-strongman", name: "Specialty / Strongman Implement", category: "OTHER", aliases: ["atlas stone", "yoke", "log press", "farmer's walk handles"], description: "Catch-all for niche strongman/circus equipment (atlas stones, yoke, chains, etc.) — correctly tagged as needing specialty gear rather than mis-classified as bodyweight." },

  // Added in the generic-machine cleanup pass — real, named, common
  // commercial-gym apparatus that the original 44-item catalog didn't have
  // a precise home for (see EXPLICIT_EQUIPMENT_OVERRIDES below).
  { slug: "hyperextension-bench", name: "Hyperextension Bench / Roman Chair / GHD", category: "BENCHES_RACKS", aliases: ["roman chair", "ghd", "glute ham developer", "back extension bench"] },
  { slug: "leverage-machine", name: "Plate-Loaded Leverage Machine", category: "OTHER", aliases: ["hammer strength machine", "iso-lateral machine"], description: "Covers leverage-machine movements with no clean functional equivalent among the specific-purpose machines above (e.g. leverage deadlift, leverage shrug) — leverage press/row variants are instead mapped to their functional equivalent (chest-press-machine, seated-row-machine, etc.) since a user who owns that machine can genuinely perform them." },
  {
    slug: "generic-machine",
    name: "Other Gym Machine",
    category: "OTHER",
    aliases: [],
    description: "Internal-only classification fallback for machine-based exercises whose specific machine could not be confidently identified. Hardening pass §14: 0 exercises actually reference it (every one was reclassified precisely — see seed_equipment.ts's EXPLICIT_EQUIPMENT_OVERRIDES), so it's kept only as a defensive FK target for the classifier, marked inactive rather than deleted (deleting it would require re-touching the classifier's fallback branch and gains nothing — an inactive, 0-reference row is already fully inert).",
    active: false,
  },
];

// ─── 2. Raw-dataset equipment string -> base equipment slug(s) ─────────────
const RAW_EQUIPMENT_MAP: Record<string, string[]> = {
  "body only": ["bodyweight"],
  dumbbell: ["dumbbell"],
  barbell: ["barbell"],
  kettlebells: ["kettlebell"],
  cable: ["cable-machine"],
  "e-z curl bar": ["ez-curl-bar"],
  bands: ["resistance-band"],
  "foam roll": ["foam-roller"], // FIX: seed_exercises_json.ts checks "foam roller" (typo) and never matches this — silently fell to BODYWEIGHT before this project.
  "medicine ball": ["medicine-ball"],
  "exercise ball": ["exercise-ball"],
};

// ─── 3. "machine" bucket -> specific machine, by exercise-name regex ───────
// Ordered; first match wins. Anything unmatched -> generic-machine (audited,
// not silently guessed).
const CLASSIFY_MACHINE: Array<[RegExp, string]> = [
  [/leg press/i, "leg-press-machine"],
  [/lying machine squat|hack squat/i, "hack-squat-machine"],
  [/leg extension/i, "leg-extension-machine"],
  [/leg curl/i, "leg-curl-machine"],
  [/abduct|adduct|inner.?outer thigh/i, "hip-adduction-abduction-machine"],
  [/glute drive|hip thrust|glute machine/i, "glute-machine"],
  [/calf raise|calf press/i, "calf-raise-machine"],
  [/pec deck|butterfly|chest fly|reverse machine flyes?/i, "pec-deck-machine"],
  [/chest press|machine bench press|bench press machine/i, "chest-press-machine"],
  [/lat pulldown|pulldown/i, "lat-pulldown-machine"],
  [/assisted/i, "assisted-pullup-dip-machine"],
  [/seated row|row machine|t-bar row|leverage.*row/i, "seated-row-machine"],
  [/shoulder.*press|military.*press/i, "shoulder-press-machine"],
  [/preacher curl|bicep curl|curl machine/i, "bicep-curl-machine"],
  [/triceps? (extension|pushdown)/i, "tricep-extension-machine"],
  [/dip/i, "dip-machine"],
  [/smith/i, "smith-machine"],
  [/rotary torso|torso rotation|ab crunch|abdominal/i, "ab-crunch-machine"],
  [/treadmill|jogging|running.*treadmill|walking.*treadmill/i, "treadmill"],
  [/stationary bike|recumbent bike|bicycling, stationary/i, "stationary-bike"],
  [/rowing/i, "rowing-machine"],
  [/stairmaster|step mill|stair/i, "stair-climber"],
  [/elliptical/i, "elliptical"],
];

// A handful of source-dataset exercises are mistagged (equipment="machine"
// on things that are plainly not a specific machine, e.g. a plyometric
// "Lunge Sprint" or a "Chair Squat" using furniture, not gym equipment) or
// have names too irregular for the regex list above to catch confidently.
// Checked BEFORE the regex list — explicit and auditable rather than
// stretching a regex until it accidentally matches.
const EXPLICIT_EQUIPMENT_OVERRIDES: Record<string, string[]> = {
  "Chair Squat": ["bodyweight"],
  "Lunge Sprint": ["bodyweight"],
  // generic-machine cleanup pass — each was manually inspected against its
  // raw instructions (see chat history / audit notes) to find the real
  // apparatus rather than left in the unclassified fallback:
  "Calf-Machine Shoulder Shrug": ["calf-raise-machine"], // instructions: "Position yourself on the calf machine so that the shoulder pads are above your shoulders"
  "Glute Ham Raise": ["hyperextension-bench"], // instructions describe a dedicated GHD apparatus (footplate + knee pad)
  "Reverse Hyperextension": ["hyperextension-bench"], // instructions describe hips hanging off a pad, same apparatus family as GHD
  "Leverage Deadlift": ["leverage-machine"], // instructions: "Load the pins... position between the handles" — plate-loaded lever machine, no hinge-pattern machine bucket exists to map it to more specifically
  "Leverage Shrug": ["leverage-machine"], // same plate-loaded lever-machine family as above
  "Hyperextensions (Back Extensions)": ["hyperextension-bench"], // eq="other" in source; a normal hyperextension uses this exact bench (see "Hyperextensions With No Hyperextension Bench" naming its absence explicitly)
  "Hyperextensions With No Hyperextension Bench": ["bodyweight"], // explicitly named as the no-apparatus variant of the exercise above
};

// ─── 4. "other"/null bucket -> equipment, by exercise-name regex ──────────
const CLASSIFY_OTHER: Array<[RegExp, string]> = [
  [/parallel bar dip/i, "dip-bars"],
  [/bench dip/i, "bench"],
  [/\bband\b/i, "resistance-band"],
  [/trx|suspension/i, "suspension-trainer"],
  [/battl(e|ing) rope/i, "battle-ropes"],
  [/sled|prowler|drag/i, "sled"],
  [/box (jump|skip)/i, "plyo-box"],
  [/rope jump|jump rope/i, "jump-rope"],
  [/atlas stone|circus bell|conan|log press|yoke|axle deadlift|chain (press|handle)|farmer/i, "specialty-strongman"],
  [/balance board/i, "specialty-strongman"],
];

function classifyBaseEquipment(rawEquipment: string | null, name: string): string[] {
  if (EXPLICIT_EQUIPMENT_OVERRIDES[name]) return EXPLICIT_EQUIPMENT_OVERRIDES[name];
  if (rawEquipment && RAW_EQUIPMENT_MAP[rawEquipment]) {
    return RAW_EQUIPMENT_MAP[rawEquipment];
  }
  if (rawEquipment === "machine") {
    for (const [re, slug] of CLASSIFY_MACHINE) {
      if (re.test(name)) return [slug];
    }
    return ["generic-machine"];
  }
  // "other" or null (or any unrecognized future value)
  for (const [re, slug] of CLASSIFY_OTHER) {
    if (re.test(name)) return [slug];
  }
  return ["bodyweight"]; // matches the observed reality: the overwhelming majority of "other"/null entries are stretches/mobility/bodyweight drills (see audit sample).
}

// ─── 5. Implied secondary equipment (bench / rack / bar) from exercise name ─
function impliedSecondaryEquipment(name: string, base: string[]): string[] {
  const extra: string[] = [];
  const n = name.toLowerCase();
  const usesFreeWeight = base.some((b) => ["barbell", "dumbbell", "ez-curl-bar"].includes(b));
  if (usesFreeWeight && /(bench|incline|decline)(?!.*floor)/i.test(n) && !/floor/i.test(n)) {
    extra.push("bench");
  }
  if (base.includes("barbell") && /\bsquat\b/i.test(n) && !/(hack|goblet|jump|box)/i.test(n)) {
    extra.push("squat-rack");
  }
  // Pull-ups/chin-ups are bodyweight-resisted but still need a fixed bar —
  // a "bodyweight only, no pull-up bar" user should not see these. Applies
  // regardless of base (plain bodyweight, or band-assisted).
  if (/pull-?up|chin-?up/i.test(n) && !/push-?up/i.test(n)) {
    extra.push("pull-up-bar");
  }
  return extra;
}

// Exercises whose specific machine has a real cable-based alternative —
// modeled as an ALTERNATIVE pair rather than a hard REQUIRED single item
// (spec §12: "do not incorrectly block an exercise merely because the user
// lacks a machine with one exact commercial name").
const CABLE_ALTERNATIVE_FAMILY = new Set([
  "lat-pulldown-machine",
  "seated-row-machine",
  "tricep-extension-machine",
  "bicep-curl-machine",
  "pec-deck-machine",
]);

async function main() {
  console.log("── Seeding Equipment catalog ──");
  const equipmentIdBySlug = new Map<string, string>();
  for (const eq of EQUIPMENT_CATALOG) {
    const row = await prisma.equipment.upsert({
      where: { slug: eq.slug },
      update: {
        name: eq.name,
        category: eq.category,
        aliases: eq.aliases ?? [],
        description: eq.description,
        active: eq.active ?? true,
      },
      create: {
        slug: eq.slug,
        name: eq.name,
        category: eq.category,
        aliases: eq.aliases ?? [],
        description: eq.description,
        active: eq.active ?? true,
      },
    });
    equipmentIdBySlug.set(eq.slug, row.id);
  }
  console.log(`Equipment catalog ready: ${equipmentIdBySlug.size} items.`);

  console.log("── Mapping exercises -> equipment ──");
  const jsonPath = path.join(__dirname, "raw_exercises.json");
  if (!fs.existsSync(jsonPath)) {
    console.warn(`raw_exercises.json not found at ${jsonPath} — skipping exercise mapping.`);
    return;
  }
  const raw: Array<{
    name: string;
    equipment: string | null;
    mechanic: string | null;
    level: string | null;
  }> = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const dbExercises = await prisma.exercise.findMany({
    select: { id: true, exerciseName: true },
  });
  const exerciseIdByName = new Map(dbExercises.map((e) => [e.exerciseName, e.id]));

  let mapped = 0;
  let unmatched = 0;
  let genericMachineCount = 0;
  let backfilled = 0;

  for (const item of raw) {
    const exerciseId = exerciseIdByName.get(item.name);
    if (!exerciseId) {
      unmatched++;
      continue;
    }

    const base = classifyBaseEquipment(item.equipment, item.name);
    const extra = impliedSecondaryEquipment(item.name, base);

    const links: Array<{ slug: string; requirementType: string }> = [];
    if (base.length === 1 && CABLE_ALTERNATIVE_FAMILY.has(base[0])) {
      links.push({ slug: base[0], requirementType: "ALTERNATIVE" });
      links.push({ slug: "cable-machine", requirementType: "ALTERNATIVE" });
    } else if (base.length === 1 && base[0] === "cable-machine" && /pulldown/i.test(item.name)) {
      // This dataset tags every real lat-pulldown-pattern exercise as plain
      // "cable" (never a distinct "machine" entry) — see seed_equipment.ts
      // audit notes. A dedicated lat-pulldown-machine still satisfies these
      // even though the raw record only says "cable".
      links.push({ slug: "cable-machine", requirementType: "ALTERNATIVE" });
      links.push({ slug: "lat-pulldown-machine", requirementType: "ALTERNATIVE" });
    } else {
      for (const slug of base) links.push({ slug, requirementType: "REQUIRED" });
    }
    for (const slug of extra) links.push({ slug, requirementType: "REQUIRED" });
    if (base.includes("generic-machine")) genericMachineCount++;

    // Recompute this exercise's links from scratch on every run — classifier
    // fixes must be able to REMOVE a stale/wrong mapping on rerun, not just
    // add new ones (upsert alone can only add/update, never drop what a
    // previous run got wrong).
    const desiredEquipmentIds = new Set(
      links.map((l) => equipmentIdBySlug.get(l.slug)).filter((id): id is string => !!id),
    );
    await prisma.exerciseEquipment.deleteMany({
      where: { exerciseId, equipmentId: { notIn: Array.from(desiredEquipmentIds) } },
    });
    for (const link of links) {
      const equipmentId = equipmentIdBySlug.get(link.slug);
      if (!equipmentId) continue; // shouldn't happen — every slug used above is in EQUIPMENT_CATALOG
      await prisma.exerciseEquipment.upsert({
        where: { exerciseId_equipmentId: { exerciseId, equipmentId } },
        update: { requirementType: link.requirementType },
        create: { exerciseId, equipmentId, requirementType: link.requirementType },
      });
    }

    // Backfill previously-dead fields (mechanics/movementPattern/difficultyLevel)
    // from the same raw record, non-destructively (only fills currently-null
    // values so any later manual curation is never overwritten).
    const existing = await prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { mechanics: true, difficultyLevel: true },
    });
    if (existing && (existing.mechanics === null || existing.difficultyLevel === null)) {
      await prisma.exercise.update({
        where: { id: exerciseId },
        data: {
          mechanics: existing.mechanics ?? item.mechanic ?? undefined,
          difficultyLevel: existing.difficultyLevel ?? item.level ?? undefined,
        },
      });
      backfilled++;
    }

    mapped++;
  }

  console.log(`Mapped ${mapped} exercises (${unmatched} names in raw JSON had no matching DB row).`);
  console.log(`  → ${genericMachineCount} exercises fell back to generic-machine (flagged for review).`);
  console.log(`  → Backfilled mechanics/difficultyLevel on ${backfilled} exercises.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
