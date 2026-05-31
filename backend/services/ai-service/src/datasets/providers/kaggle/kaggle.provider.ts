/**
 * Kaggle fitness dataset provider.
 *
 * ⚠️  ANALYTICS / DEMO USE ONLY ⚠️
 *
 * Kaggle datasets have varying licenses. Check each dataset's license page
 * before using in any commercial or redistributed product:
 *   https://www.kaggle.com/datasets
 *
 * This provider must NEVER be used as a source of live nutrition truth.
 * Intended use cases:
 *   - Development seed data
 *   - Analytics experiments
 *   - Test fixtures for ML/AI pipelines
 *
 * Datasets must be downloaded manually via the Kaggle CLI or API
 * and placed in data/datasets/kaggle/<dataset-name>/
 * See DATASETS.md for examples and download instructions.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export interface KaggleRow {
  [key: string]: string;
}

export interface KaggleDatasetInfo {
  name: string;
  filePath: string;
  rowCount: number;
  columns: string[];
}

/**
 * Stream rows from a Kaggle CSV file.
 * @param filePath  Absolute path to the CSV file
 * @param maxRows   Maximum rows to load (default: 5000)
 */
export async function loadKaggleCsv(filePath: string, maxRows = 5000): Promise<KaggleRow[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[Kaggle] File not found: ${filePath}. ` +
        'Download via Kaggle CLI: kaggle datasets download <owner/name> ' +
        'and extract to data/datasets/kaggle/',
    );
  }

  return new Promise((resolve, reject) => {
    const rows: KaggleRow[] = [];
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
      const row: KaggleRow = {};
      headers.forEach((h, i) => {
        row[h] = cols[i] ?? '';
      });
      rows.push(row);
      rowCount++;
    });

    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

/**
 * Inspect the first N rows of a Kaggle CSV without full loading.
 */
export async function previewKaggleCsv(
  filePath: string,
  previewRows = 5,
): Promise<KaggleDatasetInfo> {
  const rows = await loadKaggleCsv(filePath, previewRows);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    name: path.basename(filePath, '.csv'),
    filePath,
    rowCount: rows.length,
    columns,
  };
}

/**
 * Enumerate available Kaggle dataset directories.
 */
export function listKaggleDatasets(localPath: string): string[] {
  if (!fs.existsSync(localPath)) return [];
  return fs
    .readdirSync(localPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export const kaggleProvider = {
  loadCsv: loadKaggleCsv,
  preview: previewKaggleCsv,
  listDatasets: listKaggleDatasets,
};
