import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const forbiddenPaths = [
  'changes' + '.patch',
  'codex-changes' + '.diff',
  'frontend/web/public/favicon.svg',
  'scripts/aws/README.md',
  'scripts/aws/cleanup-quick.ps1',
  'scripts/aws/deploy-quick.ps1',
  'scripts/aws/image.png',
];

const chars = (...codes) => String.fromCharCode(...codes);
const workingTreeForbiddenFragments = [
  chars(0x2229, 0x2557, 0x2510),
  chars(0x2500, 0x00e6),
  chars(0x2500, 0x00c9),
  `c${chars(0x251c)}`,
  `ng${chars(0x255e)}`,
  `${chars(0x00df)}${chars(0x2557)}`,
  chars(0x2556),
  chars(0x2555),
  chars(0x0393),
  chars(0x2534),
  'D_' + 'Backup',
];
const diffForbiddenFragments = [
  ...workingTreeForbiddenFragments,
  chars(0x251c),
  chars(0x2563),
  chars(0x255c),
  'C:' + '\\',
];
const forbiddenTextPattern = new RegExp(
  diffForbiddenFragments.map((fragment) => fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);
const workingTreeForbiddenTextPattern = workingTreeForbiddenFragments
  .map((fragment) => fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const windowsTargetKey = 'binary' + 'Targets';
const windowsPlatform = 'win' + 'dows';
const windowsPrismaPattern = new RegExp(
  `${windowsTargetKey}\\s*=.*${windowsPlatform}|${chars(0x43, 0x3a, 0x5c)}|D_${'Backup'}`,
);
const failures = [];

for (const filePath of forbiddenPaths) {
  if (existsSync(filePath)) failures.push(`Forbidden temporary/out-of-scope file exists: ${filePath}`);
}

try {
  try {
    const grepOutput = execFileSync('git', ['grep', '-n', '-I', '-E', workingTreeForbiddenTextPattern, '--', '.'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (grepOutput.trim()) {
      failures.push('Forbidden mojibake/temp/path text found in working tree.');
      failures.push(...grepOutput.trim().split(/\r?\n/).slice(0, 20));
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || error.status !== 1) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`Unable to inspect working tree for forbidden text: ${message}`);
    }
  }

  const diff = execFileSync('git', ['diff', '-U0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const matches = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => forbiddenTextPattern.test(line));

  if (matches.length > 0) {
    failures.push(`Forbidden mojibake/temp/path text found in added diff lines (${matches.length} lines).`);
    failures.push(...matches.slice(0, 20));
  }

  const generatedPrismaMatches = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => /src\/generated\/prisma/.test(line))
    .filter((line) => windowsPrismaPattern.test(line));

  if (generatedPrismaMatches.length > 0) {
    failures.push(`Windows-specific Prisma generated output found (${generatedPrismaMatches.length} lines).`);
    failures.push(...generatedPrismaMatches.slice(0, 20));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`Unable to inspect git diff for mojibake: ${message}`);
}

if (failures.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Repository hygiene check passed.');
