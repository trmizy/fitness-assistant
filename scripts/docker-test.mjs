import { spawnSync } from 'node:child_process';

const profile = process.argv[2] || 'fast';
if (!['fast', 'full'].includes(profile)) {
  console.error('Usage: node scripts/docker-test.mjs [fast|full]');
  process.exit(2);
}

const profiles = ['--profile', profile];
const env = { ...process.env };
if (profile === 'full' && env.USE_OLLAMA === 'true') {
  profiles.push('--profile', 'ollama');
  env.LLM_PROVIDER = 'ollama';
} else {
  env.LLM_PROVIDER = 'mock';
}

console.log(`[docker-test] profile=${profile} use_ollama=${env.USE_OLLAMA || 'false'}`);
const composeFile = ['compose', '-f', 'docker-compose.test.yml'];
const upArgs = [
  ...composeFile,
  ...profiles,
  'up',
  '--build',
  '--abort-on-container-exit',
  '--exit-code-from',
  `test-runner-${profile}`,
];

const up = spawnSync('docker', upArgs, { stdio: 'inherit', env, shell: process.platform === 'win32' });
const status = up.status ?? 1;

const down = spawnSync('docker', [...composeFile, ...profiles, 'down', '-v', '--remove-orphans'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (status !== 0) process.exit(status);
process.exit(down.status ?? 0);
