import dotenv from 'dotenv';
import { Client } from 'pg';

// Load environment from repository root .env (script executed from repo root)
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set in environment');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const countRes = await client.query('SELECT count(*) FROM exercises');
    const count = countRes.rows[0].count;
    console.log('Exercise count:', count);

    const sample = await client.query(
      `SELECT id, exercise_name as "exerciseName", body_part as "bodyPart", type_of_equipment as "typeOfEquipment", type_of_activity as "typeOfActivity" FROM exercises ORDER BY created_at DESC LIMIT 10`,
    );
    console.log('\nSample exercises (up to 10):');
    console.table(sample.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('DB check failed:', err);
  process.exit(1);
});
