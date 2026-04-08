/**
 * NHANES (National Health and Nutrition Examination Survey) provider.
 *
 * ⚠️  ANALYTICS / DEMO USE ONLY ⚠️
 *
 * NHANES data is published by the CDC and is in the public domain:
 *   https://www.cdc.gov/nchs/nhanes/
 *
 * This provider must NEVER be used as a source of live nutrition truth.
 * It is intended exclusively for:
 *   - Offline analytics and population-level statistics
 *   - Demo data generation
 *   - Test/seed data for development
 *
 * NHANES datasets are large CSV/SAS files. They must be downloaded manually
 * and placed in data/datasets/nhanes/ before use.
 * See DATASETS.md for download instructions.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export interface NhanesRecord {
  seqn: string;           // Respondent sequence number
  [key: string]: string;  // Dataset-specific columns (DRTOT*, DEMO*, etc.)
}

/**
 * Stream rows from a NHANES CSV file without loading the entire file into memory.
 * @param filePath   Absolute path to the CSV file
 * @param maxRows    Maximum number of rows to return (default: 1000)
 */
export async function loadNhanesCsv(filePath: string, maxRows = 1000): Promise<NhanesRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[NHANES] File not found: ${filePath}. ` +
        'Download from https://www.cdc.gov/nchs/nhanes/ and place in data/datasets/nhanes/',
    );
  }

  return new Promise((resolve, reject) => {
    const records: NhanesRecord[] = [];
    const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
    let headers: string[] = [];
    let rowCount = 0;

    rl.on('line', (line) => {
      if (rowCount >= maxRows) {
        rl.close();
        return;
      }
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (headers.length === 0) {
        headers = cols;
        return;
      }
      const record: NhanesRecord = { seqn: '' };
      headers.forEach((h, i) => {
        record[h] = cols[i] ?? '';
      });
      records.push(record);
      rowCount++;
    });

    rl.on('close', () => resolve(records));
    rl.on('error', reject);
  });
}

/**
 * List available NHANES CSV files in the configured directory.
 */
export function listNhanesFiles(localPath: string): string[] {
  if (!fs.existsSync(localPath)) return [];
  return fs
    .readdirSync(localPath)
    .filter((f) => f.endsWith('.csv') || f.endsWith('.CSV'))
    .map((f) => path.join(localPath, f));
}

export const nhanesProvider = {
  loadCsv: loadNhanesCsv,
  listFiles: listNhanesFiles,
};
