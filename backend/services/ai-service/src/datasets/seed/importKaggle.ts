/**
 * Kaggle fitness datasets import helper.
 *
 * ⚠️  ANALYTICS / DEMO USE ONLY ⚠️
 *
 * Kaggle datasets have varying licenses — verify each one before use.
 * This script validates that datasets are present and previews their structure.
 *
 * Recommended datasets for this project:
 *
 *   1. Nutrition Dataset (ashwinik123/nutritional-facts-for-most-common-foods)
 *      Useful for: food demo data, testing food search
 *      License: Check Kaggle listing
 *      kaggle datasets download ashwinik123/nutritional-facts-for-most-common-foods
 *
 *   2. Gym Exercise Dataset (trolukovich/11000-fitness-club-members)
 *      Useful for: member analytics, demo visualizations
 *      License: Check Kaggle listing
 *
 *   3. Fitness Exercises (nickh2/top-200-fitness-exercises-with-muscle-groups)
 *      Useful for: exercise metadata, fallback exercise data
 *      License: Check Kaggle listing
 *
 * Setup:
 *   1. Install Kaggle CLI: pip install kaggle
 *   2. Configure API key: ~/.kaggle/kaggle.json
 *   3. Run: kaggle datasets download <owner/name> -p data/datasets/kaggle/<name>
 *   4. Unzip the downloaded files
 *   5. Run: npm run import:kaggle
 *
 * Usage:
 *   npm run import:kaggle
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'node:path';
import { kaggleProvider } from '../providers/kaggle/kaggle.provider';

const KAGGLE_DIR = path.join(process.cwd(), 'data', 'datasets', 'kaggle');

async function main() {
  console.log('📊  Kaggle datasets import check');
  console.log(`    Directory: ${KAGGLE_DIR}`);

  const datasets = kaggleProvider.listDatasets(KAGGLE_DIR);

  if (datasets.length === 0) {
    console.warn(
      '⚠️   No Kaggle datasets found.\n' +
        '    Download datasets and place them in: ' + KAGGLE_DIR + '\n' +
        '    Example:\n' +
        '      kaggle datasets download ashwinik123/nutritional-facts-for-most-common-foods\n' +
        `      -p ${path.join(KAGGLE_DIR, 'nutritional-facts')}`,
    );
    return;
  }

  console.log(`    Found ${datasets.length} dataset(s):`);

  for (const dataset of datasets) {
    console.log(`\n    📁 ${dataset}`);
    const datasetDir = path.join(KAGGLE_DIR, dataset);

    // Find CSV files in this dataset directory
    const { readdirSync } = await import('node:fs');
    const csvFiles = readdirSync(datasetDir).filter((f) => f.endsWith('.csv'));

    for (const csv of csvFiles.slice(0, 3)) {
      const filePath = path.join(datasetDir, csv);
      const preview = await kaggleProvider.preview(filePath, 2);
      console.log(`      📄 ${csv}: ${preview.rowCount} rows, columns: ${preview.columns.slice(0, 5).join(', ')}`);
    }
  }

  console.log('\n✅  Kaggle datasets scanned.');
  console.log('    Remember: Kaggle data is for analytics/demo only — never live nutrition truth.');
}

main().catch((err) => {
  console.error('❌  Kaggle import check failed:', err);
  process.exit(1);
});
