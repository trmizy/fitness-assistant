/**
 * NHANES demo data import helper.
 *
 * ⚠️  ANALYTICS / DEMO USE ONLY ⚠️
 *
 * NHANES datasets must be downloaded manually from the CDC website.
 * This script validates that the expected files are present and
 * generates a metadata summary file for easy reference.
 *
 * Manual download steps:
 *   1. Go to https://www.cdc.gov/nchs/nhanes/search/datapage.aspx
 *   2. Select the desired survey cycle (e.g., 2017-2018)
 *   3. Download the dietary intake file (e.g., DR1TOT_J.csv)
 *      and the demographics file (DEMO_J.csv)
 *   4. Place files in data/datasets/nhanes/
 *
 * Usage:
 *   npm run import:nhanes
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { nhanesProvider } from '../providers/nhanes/nhanes.provider';

const NHANES_DIR = path.join(process.cwd(), 'data', 'datasets', 'nhanes');

async function main() {
  console.log('📊  NHANES data import check');
  console.log(`    Directory: ${NHANES_DIR}`);

  const files = nhanesProvider.listFiles(NHANES_DIR);

  if (files.length === 0) {
    console.warn(
      '⚠️   No NHANES CSV files found.\n' +
        '    Download from: https://www.cdc.gov/nchs/nhanes/search/datapage.aspx\n' +
        `    Place .csv files in: ${NHANES_DIR}`,
    );
    return;
  }

  console.log(`    Found ${files.length} file(s):`);
  const meta: Record<string, { rowCount: number; columns: string[] }> = {};

  for (const filePath of files) {
    const name = path.basename(filePath);
    console.log(`    Processing ${name}...`);
    const rows = await nhanesProvider.loadCsv(filePath, 5);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    meta[name] = { rowCount: rows.length, columns };
    console.log(`      Columns: ${columns.slice(0, 6).join(', ')}${columns.length > 6 ? '...' : ''}`);
  }

  const summaryPath = path.join(NHANES_DIR, '_meta.json');
  fs.writeFileSync(summaryPath, JSON.stringify(meta, null, 2), 'utf-8');
  console.log(`✅  Metadata written to ${summaryPath}`);
  console.log('    Remember: NHANES data is for analytics/demo only — never live nutrition truth.');
}

main().catch((err) => {
  console.error('❌  NHANES import failed:', err);
  process.exit(1);
});
