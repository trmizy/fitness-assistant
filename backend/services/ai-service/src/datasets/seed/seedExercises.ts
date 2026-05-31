/**
 * Seed local exercise data from free-exercise-db.
 *
 * This script downloads the exercises.json from the free-exercise-db GitHub
 * repository and saves it to data/datasets/free-exercise-db/exercises.json.
 *
 * Usage:
 *   npm run seed:exercises
 *
 * The file is ~800KB and contains ~870 exercises (MIT license).
 * You only need to run this once (or after clearing the data folder).
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { httpGet } from '../utils/httpClient';

const FREE_EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

const OUTPUT_PATH = path.join(process.cwd(), 'data', 'datasets', 'free-exercise-db', 'exercises.json');

async function main() {
  console.log('📥  Downloading free-exercise-db exercises...');
  console.log(`    Source: ${FREE_EXERCISE_DB_URL}`);
  console.log(`    Target: ${OUTPUT_PATH}`);

  try {
    const data = await httpGet<unknown[]>(FREE_EXERCISE_DB_URL, {}, {}, 30_000);

    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format — expected an array of exercises.');
    }

    const dir = path.dirname(OUTPUT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`✅  Saved ${data.length} exercises to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('❌  Failed to download exercises:', err);
    process.exit(1);
  }
}

main();
