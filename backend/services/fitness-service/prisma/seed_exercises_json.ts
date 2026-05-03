import { PrismaClient, ExerciseType, EquipmentType, BodyPart, MovementType } from '../src/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking exercise seed...');

  // Idempotent guard — skip if exercises already exist
  const existingCount = await prisma.exercise.count();
  if (existingCount > 0) {
    console.log(`Seed skipped: ${existingCount} exercises already in database.`);
    return;
  }

  console.log('No exercises found. Starting seed...');

  const jsonPath = path.join(__dirname, 'raw_exercises.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`CRITICAL ERROR: Seed file not found at ${jsonPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf8');
  const exercises = JSON.parse(rawData);

  console.log(`Found ${exercises.length} exercises to import.`);

  let count = 0;
  for (const item of exercises) {
    try {
      // Map Category to ExerciseType
      let typeOfActivity: ExerciseType = ExerciseType.STRENGTH;
      if (item.category === 'cardio') typeOfActivity = ExerciseType.CARDIO;
      else if (item.category === 'stretching') typeOfActivity = ExerciseType.MOBILITY;

      // Map Equipment to EquipmentType
      let typeOfEquipment: EquipmentType = EquipmentType.BODYWEIGHT;
      const equip = item.equipment?.toLowerCase() || '';
      if (equip.includes('barbell')) typeOfEquipment = EquipmentType.BARBELL;
      else if (equip.includes('dumbbell')) typeOfEquipment = EquipmentType.DUMBBELLS;
      else if (equip.includes('kettlebell')) typeOfEquipment = EquipmentType.KETTLEBELL;
      else if (equip.includes('machine')) typeOfEquipment = EquipmentType.MACHINE;
      else if (equip.includes('cable')) typeOfEquipment = EquipmentType.CABLE;
      else if (equip.includes('medicine ball')) typeOfEquipment = EquipmentType.MEDICINE_BALL;
      else if (equip.includes('foam roller')) typeOfEquipment = EquipmentType.FOAM_ROLLER;
      else if (equip.includes('body only')) typeOfEquipment = EquipmentType.BODYWEIGHT;

      // Map Muscles to BodyPart
      let bodyPart: BodyPart = BodyPart.FULL_BODY;
      const primary = item.primaryMuscles[0]?.toLowerCase() || '';
      if (['abdominals', 'lower back'].includes(primary)) bodyPart = BodyPart.CORE;
      else if (['quadriceps', 'hamstrings', 'glutes', 'calves'].includes(primary)) bodyPart = BodyPart.LOWER_BODY;
      else if (['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'traps', 'lats'].includes(primary)) bodyPart = BodyPart.UPPER_BODY;

      // Map Force to MovementType
      let movementType: MovementType = MovementType.PUSH;
      if (item.force === 'pull') movementType = MovementType.PULL;
      else if (item.force === 'static') movementType = MovementType.HOLD;

      // Image URL
      const videoUrl = item.images && item.images.length > 0 
        ? `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${item.images[0]}`
        : null;

      await prisma.exercise.create({
        data: {
          exerciseName: item.name,
          typeOfActivity,
          typeOfEquipment,
          bodyPart,
          type: movementType,
          muscleGroupsActivated: [...item.primaryMuscles, ...item.secondaryMuscles],
          instructions: item.instructions.join('\n'),
          videoUrl,
        },
      });
      count++;
      if (count % 100 === 0) console.log(`Imported ${count} exercises...`);
    } catch (error) {
      console.error(`Failed to import exercise: ${item.name}`, error);
    }
  }

  console.log(`Seed finished! Successfully imported ${count} exercises.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
