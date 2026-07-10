import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const forbiddenPaths = [
  'changes.patch',
  'codex-changes.diff',
  'frontend/web/public/favicon.svg',
  'scripts/aws/README.md',
  'scripts/aws/cleanup-quick.ps1',
  'scripts/aws/deploy-quick.ps1',
  'scripts/aws/image.png',
];

const textExtensions = new Set([
  '.css',
  '.csv',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.prisma',
  '.ps1',
  '.py',
  '.sh',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const skipPathFragments = [
  '/node_modules/',
  '/dist/',
  '/build/',
  '/coverage/',
  '/.git/',
  '/src/generated/prisma/',
  '/training/outputs/',
  '/training/checkpoints/',
  '/training/adapters/',
  '/training/merged_models/',
  '/training/reports/',
];

const chars = (...codes) => String.fromCharCode(...codes);
const mojibakePatterns = [
  `V${chars(0x00c3)}`,
  `${chars(0x00e1)}${chars(0x00ba)}`,
  `${chars(0x00e1)}${chars(0x00bb)}`,
  `${chars(0x00c4)}${chars(0x2018)}`,
  `${chars(0x00c6)}${chars(0x00b0)}`,
  `${chars(0x00e2)}${chars(0x20ac)}`,
  `${chars(0x00e2)}${chars(0x2020)}`,
  chars(0x2229, 0x2557, 0x2510),
  chars(0x2500, 0x00e6),
  chars(0x2500, 0x00c9),
  chars(0x2534),
];

const personalPathPatterns = [
  `C:${chars(0x5c, 0x5c)}${'D_' + 'Backup'}`,
  `D:${chars(0x5c, 0x5c)}${'project_' + 'personal'}`,
  `C:${chars(0x5c, 0x5c)}${'Us' + 'ers'}`,
];
const prismaBinaryTargetsPattern = `${'binary' + 'Targets'}\\s*=.*${'win' + 'dows'}`;
const generatedPrismaWindowsPattern = new RegExp(
  `${prismaBinaryTargetsPattern}|${personalPathPatterns.map((item) => item.replace(/\\/g, '\\\\')).join('|')}`,
  'i',
);
const failures = [];

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function trackedFiles() {
  return runGit(['ls-files'])
    .split(/\r?\n/)
    .filter(Boolean);
}

function normalizePath(filePath) {
  return `/${filePath.replace(/\\/g, '/')}`;
}

function shouldSkip(filePath) {
  const normalized = normalizePath(filePath);
  return skipPathFragments.some((fragment) => normalized.includes(fragment));
}

function isLikelyTextFile(filePath) {
  const base = path.basename(filePath);
  if (base === '.env.example' || base === '.gitignore' || base === '.dockerignore' || base === '.gitattributes') {
    return true;
  }
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function readUtf8(filePath) {
  const buffer = readFileSync(filePath);
  return { buffer, text: buffer.toString('utf8') };
}

function lineCount(text) {
  if (!text) return 0;
  return text.split(/\n/).length;
}

for (const filePath of forbiddenPaths) {
  if (existsSync(filePath)) failures.push(`Forbidden temporary/out-of-scope file exists: ${filePath}`);
}

for (const filePath of trackedFiles()) {
  if (shouldSkip(filePath) || !existsSync(filePath) || !statSync(filePath).isFile() || !isLikelyTextFile(filePath)) {
    continue;
  }

  const { buffer, text } = readUtf8(filePath);

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    failures.push(`UTF-8 BOM found: ${filePath}`);
  }

  if (text.includes('\r\n')) {
    failures.push(`CRLF line endings found: ${filePath}`);
  }

  for (const pattern of mojibakePatterns) {
    if (text.includes(pattern)) {
      failures.push(`Mojibake marker "${pattern}" found: ${filePath}`);
      break;
    }
  }

  if (personalPathPatterns.some((pattern) => text.includes(pattern))) {
    failures.push(`Personal Windows path found: ${filePath}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if ((extension === '.json' || extension === '.yml' || extension === '.yaml') && text.length > 300 && lineCount(text) <= 2) {
    failures.push(`Possibly minified ${extension.slice(1).toUpperCase()} file: ${filePath}`);
  }
}

try {
  const diff = runGit(['diff', '-U0']);
  const generatedPrismaMatches = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .filter((line) => /src\/generated\/prisma/.test(line))
    .filter((line) => generatedPrismaWindowsPattern.test(line));

  if (generatedPrismaMatches.length > 0) {
    failures.push(`Windows-specific Prisma generated output found (${generatedPrismaMatches.length} lines).`);
    failures.push(...generatedPrismaMatches.slice(0, 20));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`Unable to inspect git diff: ${message}`);
}

if (failures.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const failure of failures.slice(0, 100)) console.error(`- ${failure}`);
  if (failures.length > 100) console.error(`- ... ${failures.length - 100} more issue(s)`);
  process.exit(1);
}

console.log('Repository hygiene check passed.');
