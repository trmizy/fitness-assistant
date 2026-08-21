/**
 * Gym-onboarding project — closes the "equipment with zero exercises" gap
 * for suspension-trainer, assisted-pullup-dip-machine, and glute-machine.
 *
 * These are real, common commercial-gym equipment that the free-exercise-db
 * source dataset (prisma/raw_exercises.json) simply doesn't have named
 * exercises for under ANY searched synonym (verified by search, not
 * assumed — see chat history). Per the project's own rule ("a selectable
 * onboarding equipment item should provide actual exercise capability"),
 * this adds a small, high-quality, standard/well-established set rather
 * than leaving the equipment orphaned or hiding it from onboarding.
 *
 * Every movement here is a textbook, unambiguous exercise (TRX row/push-up/
 * curl, assisted pull-up/dip machine, machine hip thrust) — not invented
 * biomechanics. Idempotent: skips any exercise name that already exists.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx prisma/seed_equipment_gap_exercises.ts
 */
import { PrismaClient, ExerciseType, EquipmentType, BodyPart, MovementType } from "../src/generated/prisma";

const prisma = new PrismaClient();

type CuratedExercise = {
  exerciseName: string;
  typeOfEquipment: EquipmentType; // coarse legacy enum — best-fit bucket
  bodyPart: BodyPart;
  type: MovementType;
  muscleGroupsActivated: string[];
  mechanics: "compound" | "isolation";
  instructions: string;
  equipmentSlugs: string[]; // normalized catalog — precise
  movementPattern: string;
};

const CURATED: CuratedExercise[] = [
  {
    exerciseName: "Suspension Row",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PULL,
    muscleGroupsActivated: ["back", "biceps", "middle back"],
    mechanics: "compound",
    instructions:
      "Attach the suspension straps to a secure anchor point overhead. Grip the handles, walk your feet forward, and lean back with arms extended and body straight, forming a diagonal line. Pull your chest toward the handles by driving your elbows back, squeezing your shoulder blades together. Slowly lower back to the starting position. Adjust foot position closer to the anchor to increase difficulty.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "HORIZONTAL_PULL",
  },
  {
    exerciseName: "Suspension Push-Up",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["chest", "triceps", "shoulders"],
    mechanics: "compound",
    instructions:
      "Set the suspension straps to mid-length. Hold a handle in each hand and assume a plank position with hands beneath your shoulders, body straight from head to heels. Lower your chest toward your hands by bending the elbows, then press back up to full extension. The straps add an instability element that increases core and shoulder-stabilizer demand versus a floor push-up.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "HORIZONTAL_PUSH",
  },
  {
    exerciseName: "Suspension Chest Press",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["chest", "triceps", "shoulders"],
    mechanics: "compound",
    instructions:
      "Face away from the anchor point holding a handle in each hand, arms extended in front of you, leaning forward with body straight. Bend the elbows to lower your chest toward your hands, then press back to the starting position. Standing (rather than the plank position of a suspension push-up) shifts more load through the chest and shoulders.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "HORIZONTAL_PUSH",
  },
  {
    exerciseName: "Suspension Biceps Curl",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PULL,
    muscleGroupsActivated: ["biceps", "forearms"],
    mechanics: "isolation",
    instructions:
      "Face the anchor point holding a handle in each hand, palms up, leaning back with arms extended and body straight. Keeping your upper arms fixed, curl your hands toward your forehead by flexing the elbows. Slowly extend back to the starting position.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "ELBOW_FLEXION",
  },
  {
    exerciseName: "Suspension Triceps Extension",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["triceps"],
    mechanics: "isolation",
    instructions:
      "Face away from the anchor point holding a handle in each hand at forehead height, elbows bent and pointed forward, leaning forward with body straight. Extend the elbows to press your hands forward and down, then return under control.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "ELBOW_EXTENSION",
  },
  {
    exerciseName: "Suspension Assisted Squat",
    typeOfEquipment: EquipmentType.BODYWEIGHT,
    bodyPart: BodyPart.LOWER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["quadriceps", "glutes", "hamstrings"],
    mechanics: "compound",
    instructions:
      "Hold a handle in each hand with arms extended toward the anchor point for balance/counterweight assistance. Keeping your chest up, squat down by bending the hips and knees until thighs are roughly parallel to the floor, then drive back up. Useful for beginners building squat depth/balance, or for adding tempo control at higher reps.",
    equipmentSlugs: ["suspension-trainer"],
    movementPattern: "SQUAT",
  },
  {
    exerciseName: "Machine Assisted Pull-Up",
    typeOfEquipment: EquipmentType.MACHINE,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PULL,
    muscleGroupsActivated: ["lats", "biceps", "middle back"],
    mechanics: "compound",
    instructions:
      "Select an assistance weight on the pin stack (more weight = more assistance) and kneel or stand on the platform/pad. Grip the handles with a shoulder-width or wider overhand grip. Pull your chest up toward the handles until your chin clears them, then lower under control to full arm extension. Reduce the assistance weight over time as pulling strength improves.",
    equipmentSlugs: ["assisted-pullup-dip-machine"],
    movementPattern: "VERTICAL_PULL",
  },
  {
    exerciseName: "Machine Assisted Dip",
    typeOfEquipment: EquipmentType.MACHINE,
    bodyPart: BodyPart.UPPER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["triceps", "chest", "shoulders"],
    mechanics: "compound",
    instructions:
      "Select an assistance weight on the pin stack and kneel or stand on the platform/pad. Grip the parallel handles and lower your body by bending the elbows until your upper arms are roughly parallel to the floor, then press back up to full extension. Leaning slightly forward emphasizes chest; staying upright emphasizes triceps.",
    equipmentSlugs: ["assisted-pullup-dip-machine"],
    movementPattern: "VERTICAL_PUSH",
  },
  {
    exerciseName: "Machine Hip Thrust",
    typeOfEquipment: EquipmentType.MACHINE,
    bodyPart: BodyPart.LOWER_BODY,
    type: MovementType.PUSH,
    muscleGroupsActivated: ["glutes", "hamstrings"],
    mechanics: "compound",
    instructions:
      "Sit against the machine's back pad with the pad positioned across your hips, feet flat on the platform roughly hip-width apart. Drive through your heels to extend your hips upward until your torso and thighs form a straight line, squeezing your glutes at the top. Lower under control back to the starting position without letting your hips sag.",
    equipmentSlugs: ["glute-machine"],
    movementPattern: "HIP_EXTENSION",
  },
];

async function main() {
  console.log("── Adding curated exercises for zero-coverage equipment ──");
  let created = 0;
  let skipped = 0;

  for (const item of CURATED) {
    const existing = await prisma.exercise.findFirst({ where: { exerciseName: item.exerciseName } });
    if (existing) {
      skipped++;
      continue;
    }

    const exercise = await prisma.exercise.create({
      data: {
        exerciseName: item.exerciseName,
        typeOfActivity: ExerciseType.STRENGTH,
        typeOfEquipment: item.typeOfEquipment,
        bodyPart: item.bodyPart,
        type: item.type,
        muscleGroupsActivated: item.muscleGroupsActivated,
        instructions: item.instructions,
        mechanics: item.mechanics,
        movementPattern: item.movementPattern,
        difficultyLevel: "intermediate",
      },
    });

    for (const slug of item.equipmentSlugs) {
      const equipment = await prisma.equipment.findUnique({ where: { slug } });
      if (!equipment) {
        console.warn(`  ⚠ equipment slug "${slug}" not found — skipping link for ${item.exerciseName}`);
        continue;
      }
      await prisma.exerciseEquipment.create({
        data: { exerciseId: exercise.id, equipmentId: equipment.id, requirementType: "REQUIRED" },
      });
    }

    created++;
  }

  console.log(`Created ${created} curated exercises, skipped ${skipped} already-existing.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
