import { PrismaClient, ExerciseType, EquipmentType, BodyPart, MovementType } from '../src/generated/prisma';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const prisma = new PrismaClient();

async function seedExercises() {
  console.log('Checking exercise seed...');

  const existingCount = await prisma.exercise.count();
  if (existingCount > 0) {
    console.log(`Exercise seed skipped: ${existingCount} exercises already in database.`);
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
      let typeOfActivity: ExerciseType = ExerciseType.STRENGTH;
      if (item.category === 'cardio') typeOfActivity = ExerciseType.CARDIO;
      else if (item.category === 'stretching') typeOfActivity = ExerciseType.MOBILITY;

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

      let bodyPart: BodyPart = BodyPart.FULL_BODY;
      const primary = item.primaryMuscles[0]?.toLowerCase() || '';
      if (['abdominals', 'lower back'].includes(primary)) bodyPart = BodyPart.CORE;
      else if (['quadriceps', 'hamstrings', 'glutes', 'calves'].includes(primary)) bodyPart = BodyPart.LOWER_BODY;
      else if (['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'traps', 'lats'].includes(primary)) bodyPart = BodyPart.UPPER_BODY;

      let movementType: MovementType = MovementType.PUSH;
      if (item.force === 'pull') movementType = MovementType.PULL;
      else if (item.force === 'static') movementType = MovementType.HOLD;

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

  console.log(`Exercise seed finished — ${count} exercises imported.`);
}

async function seedFoods() {
  console.log('Checking food seed...');

  const existing = await prisma.food.count();
  if (existing > 0) {
    console.log(`Food seed skipped: ${existing} foods already in database.`);
    return;
  }

  // Works both in Docker (/app/data) and local runs
  const candidates = [
    '/app/data/nutrition/foods_seed.csv',
    path.join(__dirname, '../../../../data/nutrition/foods_seed.csv'),
  ];
  const csvPath = candidates.find((p) => fs.existsSync(p));

  if (!csvPath) {
    console.warn('⚠️  foods_seed.csv not found — skipping food seed.');
    console.warn('   Generate it with: pnpm --filter @gym-coach/fitness-service db:process-usda');
    return;
  }

  console.log(`Seeding foods from ${csvPath}...`);

  const BATCH_SIZE = 500;
  const batch: {
    fdcId: number; name: string; calories: number;
    protein: number; carbs: number; fats: number; source: string;
  }[] = [];
  let total = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await prisma.food.createMany({ data: batch, skipDuplicates: true });
    total += batch.length;
    batch.length = 0;
  };

  await new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let header = true;
    rl.on('line', (line) => {
      if (header) { header = false; return; }
      if (!line.trim()) return;

      // Format: fdc_id,"name with possible, commas",calories,protein,carbs,fats,source
      const firstComma = line.indexOf(',');
      const rest = line.slice(firstComma + 1);
      const lastQuote = rest.lastIndexOf('"');
      const name = rest.slice(1, lastQuote).replace(/""/g, '"');
      const [cal, prot, carb, fat, source] = rest.slice(lastQuote + 2).split(',');

      const fdcId = parseInt(line.slice(0, firstComma), 10);
      if (isNaN(fdcId)) return;

      batch.push({
        fdcId,
        name,
        calories: parseFloat(cal) || 0,
        protein:  parseFloat(prot) || 0,
        carbs:    parseFloat(carb) || 0,
        fats:     parseFloat(fat)  || 0,
        source:   source?.trim() ?? 'sr_legacy',
      });

      if (batch.length >= BATCH_SIZE) {
        rl.pause();
        flush().then(() => rl.resume()).catch(reject);
      }
    });
    rl.on('close', () => flush().then(resolve).catch(reject));
    rl.on('error', reject);
  });

  console.log(`✅  Food seed complete — ${total} foods imported.`);
}

async function main() {
  await seedExercises();
  await seedFoods();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
