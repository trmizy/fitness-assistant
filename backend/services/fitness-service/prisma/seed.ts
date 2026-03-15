import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Parse CSV line with proper handling of quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log('Seeding exercises from CSV...');

  // Read CSV file
  const csvPath = path.join(__dirname, '../../../data/data.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

  console.log(`Processing ${lines.length} lines...`);

  let successCount = 0;
  let errorCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const fields = parseCSVLine(line);
      
      if (fields.length < 8) {
        console.log(`Skipping line with ${fields.length} fields: ${line.substring(0, 50)}...`);
        errorCount++;
        continue;
      }

      const [
        id,
        exercise_name,
        type_of_activity,
        type_of_equipment,
        body_part,
        type,
        muscle_groups_activated,
        instructions,
      ] = fields;

      if (!exercise_name) {
        console.log('Skipping line with no exercise name');
        errorCount++;
        continue;
      }

      // Map CSV values to enums
      const activityTypeMap: Record<string, string> = {
        'Strength': 'STRENGTH',
        'Cardio': 'CARDIO',
        'Mobility': 'MOBILITY',
        'Strength/Mobility': 'STRENGTH_MOBILITY',
        'Cardio/Strength': 'STRENGTH_CARDIO',
      };

      const equipmentMap: Record<string, string> = {
        'Bodyweight': 'BODYWEIGHT',
        'Barbell': 'BARBELL',
        'Dumbbells': 'DUMBBELLS',
        'Kettlebell': 'KETTLEBELL',
        'Machine': 'MACHINE',
        'Resistance Band': 'RESISTANCE_BAND',
        'Cable': 'CABLE',
        'Medicine Ball': 'MEDICINE_BALL',
        'Foam Roller': 'FOAM_ROLLER',
      };

      const bodyPartMap: Record<string, string> = {
        'Upper Body': 'UPPER_BODY',
        'Lower Body': 'LOWER_BODY',
        'Core': 'CORE',
        'Full Body': 'FULL_BODY',
      };

      const movementMap: Record<string, string> = {
        'Push': 'PUSH',
        'Pull': 'PULL',
        'Hold': 'HOLD',
        'Stretch': 'STRETCH',
      };

      const exerciseData = {
        exerciseName: exercise_name,
        typeOfActivity: activityTypeMap[type_of_activity] || 'STRENGTH',
        typeOfEquipment: equipmentMap[type_of_equipment] || 'BODYWEIGHT',
        bodyPart: bodyPartMap[body_part] || 'UPPER_BODY',
        type: movementMap[type] || 'PUSH',
        muscleGroupsActivated: muscle_groups_activated 
          ? muscle_groups_activated.split(';').map((m) => m.trim()).filter(Boolean)
          : [],
        instructions: instructions || '',
      };

      await prisma.exercise.create({ data: exerciseData });
      successCount++;
      
      if (successCount % 50 === 0) {
        console.log(`Inserted ${successCount} exercises...`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`Failed on line: ${line.substring(0, 50)}... - ${error.message}`);
    }
  }

  console.log(`✅ Seeding complete! Success: ${successCount}, Errors: ${errorCount}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
