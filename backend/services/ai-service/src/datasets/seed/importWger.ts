/**
 * Import wger exercise catalog into a local JSON cache.
 *
 * Fetches exercises from the public wger instance in pages and writes them
 * to data/datasets/wger/exercises.json for offline use.
 *
 * Usage:
 *   npm run import:wger
 *
 * Options (via env):
 *   WGER_BASE_URL   Override the wger instance (default: https://wger.de/api/v2)
 *   WGER_LIMIT      Page size per request (default: 100)
 *
 * License note: wger is AGPLv3. Fetching from the public API is fine for
 * personal/development use. Self-host wger if you need production reliability.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { wgerProvider } from '../providers/wger/wger.provider';
import type { ExerciseItem } from '../types';

const BASE_URL = process.env.WGER_BASE_URL ?? 'https://wger.de/api/v2';
const PAGE_SIZE = Number(process.env.WGER_LIMIT ?? 100);
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'datasets', 'wger', 'exercises.json');

async function main() {
  console.log('📥  Importing wger exercise catalog...');
  console.log(`    Source: ${BASE_URL}`);

  const allExercises: ExerciseItem[] = [];
  let offset = 0;
  let total = Infinity;

  while (allExercises.length < total) {
    const result = await wgerProvider.listExercises(BASE_URL, PAGE_SIZE, offset);
    if (result.items.length === 0) break;

    allExercises.push(...result.items);
    total = result.total;
    offset += PAGE_SIZE;

    process.stdout.write(`    Fetched ${allExercises.length} / ${total}\r`);

    // Polite delay to avoid hammering the public instance
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n    Total fetched: ${allExercises.length}`);

  const dir = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allExercises, null, 2), 'utf-8');

  console.log(`✅  Saved wger exercises to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('❌  wger import failed:', err);
  process.exit(1);
});
