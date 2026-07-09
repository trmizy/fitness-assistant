import { execFileSync } from 'child_process';

if (process.env.ENABLE_RESEARCH_AUTOMATION !== 'true') {
  console.log(JSON.stringify({ status: 'disabled', reason: 'ENABLE_RESEARCH_AUTOMATION is not true' }, null, 2));
  process.exit(0);
}

const cron = process.env.RESEARCH_AUTOMATION_CRON || 'external-cron';
console.log(JSON.stringify({ status: 'enabled', cron, mode: 'single-run' }, null, 2));
execFileSync(process.execPath, ['-r', 'tsx/cjs', 'src/scripts/researchFetch.ts'], { stdio: 'inherit' });
