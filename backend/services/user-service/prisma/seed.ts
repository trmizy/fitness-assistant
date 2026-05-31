// Main seed entry point — runs all seeders in order
// Usage: npm run db:seed
import 'dotenv/config';

import { execSync } from 'child_process';
import * as path from 'path';

const seeders = ['seed_vietnam_locations.ts'];

for (const seeder of seeders) {
  const filePath = path.join(__dirname, seeder);
  console.log(`\n▶ Running ${seeder}...`);
  execSync(`npx tsx -r dotenv/config "${filePath}"`, { stdio: 'inherit' });
  console.log(`✓ ${seeder} done`);
}
