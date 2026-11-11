import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = 'test/conversational-intelligence/results/codex-remediation';
fs.mkdirSync(dir, { recursive: true });
const mode = process.argv[2];
const jobs = mode === 'regression' ? ['off', 'on'].map(flag => [
  `regression-${flag}`, 'docker', ['exec', '-e', `CONVERSATIONAL_INTELLIGENCE_V2=${flag}`, '-e', 'CONVERSATIONAL_INTELLIGENCE_V2_LLM=off', 'gymcoach-ai-dev', 'sh', '-c', 'cd /app/backend/services/ai-service && npx tsx --test src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts src/__tests__/conversational-intelligence-*.test.ts']
]) : mode === 'http' ? [
  ['missing-http', 'node', ['.tmp-stack/rem-missing-http.mjs']],
  ['live-golden', 'node', ['test/conversational-intelligence/live-golden.mjs']],
  ['live-global', 'node', ['test/conversational-intelligence/live-global.mjs']],
] : mode === 'boundary' ? [['boundary', 'docker', ['exec', 'gymcoach-ai-dev', 'sh', '-c', 'cd /app/backend/services/ai-service && npx tsx --test src/__tests__/codex-remediation-boundary.test.ts']]] : [['browser', 'node', ['test/ai-chat-full-verification/browser-e2e.mjs', 'remediation', 'remediationmobile']]];
for (const [label, cmd, args] of jobs) {
  const shotsDir = 'test/ai-chat-full-verification/results/screenshots';
  const shots = label === 'browser' ? fs.readdirSync(shotsDir).filter(p => p.includes('-rem-')).map(p => [p, fs.readFileSync(`${shotsDir}/${p}`)]) : [];
  const backups = ['test/conversational-intelligence/results/live-golden.json', 'test/conversational-intelligence/results/live-global.json'];
  const saved = backups.map(p => fs.existsSync(p) ? fs.readFileSync(p) : null);
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1200000, maxBuffer: 60000000 });
  fs.writeFileSync(`${dir}/${label}.log`, (r.stdout ?? '') + (r.stderr ?? ''));
  fs.writeFileSync(`${dir}/${label}-status.json`, JSON.stringify({ at: new Date().toISOString(), exit: r.status, ms: Date.now() - t, error: r.error?.message, cmd, args }, null, 2));
  if (label === 'browser') {
    fs.mkdirSync(`${dir}/screenshots`, {recursive:true});
    for (const p of fs.readdirSync(shotsDir).filter(p => p.includes('-rem-'))) fs.copyFileSync(`${shotsDir}/${p}`, `${dir}/screenshots/${p}`);
    for (const [p, bytes] of shots) fs.writeFileSync(`${shotsDir}/${p}`, bytes);
  }
  backups.forEach((p, i) => { if (fs.existsSync(p) && !fs.readFileSync(p).equals(saved[i] ?? Buffer.alloc(0))) { fs.copyFileSync(p, `${dir}/${p.split('/').pop()}`); if (saved[i]) fs.writeFileSync(p, saved[i]); } });
  console.log(label, r.status, (r.stdout ?? '').slice(-1800), r.error?.message ?? '');
}
