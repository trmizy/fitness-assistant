/**
 * dataPipelineAll.ts
 * ──────────────────
 * Master script: runs download → processNhanes → processPapers in sequence.
 *
 * Usage:
 *   npm run data:all
 *   npm run data:all -- --force
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

const FORCE = process.argv.includes('--force') ? ' -- --force' : '';
const run = (label: string, cmd: string) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log('─'.repeat(60));
  execSync(cmd, { stdio: 'inherit', cwd: path.resolve(process.cwd()) });
};

try {
  run('1/3  Download research data', `npm run data:download${FORCE}`);
  run('2/3  Process NHANES XPT files', `npm run data:process:nhanes${FORCE}`);
  run('3/3  Process research papers (PDF)', `npm run data:process:papers${FORCE}`);
  console.log('\n\n✅  Full data pipeline complete.');
  console.log('    Next: npm run ingest  (to push to Qdrant vector DB)');
} catch (err: any) {
  console.error('\n❌  Pipeline failed:', err.message);
  process.exit(1);
}
