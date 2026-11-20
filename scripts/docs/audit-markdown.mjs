import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = 'docs/maintenance/markdown-inventory.json';
const run = (command, args) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).trim();
const lines = (value) => value.split(/\r?\n/).filter(Boolean);
const posix = (value) => value.replaceAll('\\', '/');
const files = lines(run('rg', ['--files', '--hidden',
  '-g', '!.git', '-g', '!node_modules', '-g', '!.codex',
  '-g', '!.dev', '-g', '!_warroom', '-g', '!dist', '-g', '!build',
])).map(posix).sort();
const docs = files.filter((file) => file.startsWith('docs/') && file.endsWith('.md'));
const changed = new Set([
  ...lines(run('git', ['diff', '--name-only'])),
  ...lines(run('git', ['diff', '--cached', '--name-only'])),
  ...lines(run('git', ['ls-files', '--others', '--exclude-standard'])),
].map(posix));
const extensions = new Set(['.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json',
  '.yaml', '.yml', '.prisma', '.ps1', '.toml', '.sql', '.sh']);
const sources = [];
for (const file of files) {
  if (file === output || !extensions.has(path.extname(file))) continue;
  if (/lock\.(json|yaml)$/.test(file)) continue;
  const full = path.join(root, file);
  if (fs.statSync(full).size > 1024 * 1024) continue;
  const content = fs.readFileSync(full, 'utf8');
  if (content.includes('\0')) continue;
  if (!content.includes('.md')) continue;
  sources.push({ file, content });
}
const entries = docs.map((file) => {
  const bytes = fs.readFileSync(path.join(root, file));
  const basename = path.posix.basename(file);
  const needles = [file, basename, encodeURI(file), encodeURI(basename),
    file.replaceAll('/', '\\')];
  const refs = sources.filter((source) => source.file !== file &&
    needles.some((needle) => source.content.includes(needle))).map((source) => source.file);
  const historicalManifestReferences = refs.filter((ref) => ref.endsWith('/baseline-integrity.json'));
  const referenceFiles = refs.filter((ref) => !historicalManifestReferences.includes(ref));
  const disposition = changed.has(file) ? 'protected_worktree'
    : ['README.md', 'STATUS.md'].includes(basename) ? 'entrypoint'
    : / - Copy\.md$/i.test(basename) ? 'review_copy'
    : referenceFiles.length ? 'referenced' : 'review_no_reference';
  return { path: file, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    disposition, referenceFiles, historicalManifestReferences };
});
const byHash = Map.groupBy(entries, (entry) => entry.sha256);
const duplicates = [...byHash.values()].filter((group) => group.length > 1)
  .map((group) => group.map((entry) => entry.path));
const counts = {};
for (const entry of entries) counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1;
const inventory = {
  generatedAt: new Date().toISOString(),
  head: run('git', ['rev-parse', 'HEAD']),
  scope: 'Markdown under docs; metadata/reference scan only, not content review',
  limitations: [
    'References are literal path/basename mentions, not a full Markdown or code dependency graph.',
    'No reference does not mean unused; referenced does not mean current.',
    'rg respects ignore rules; excludes .git/node_modules/.codex/.dev/_warroom/dist/build.',
    'Only selected text extensions up to 1 MiB; excludes lockfiles, binary text and output itself.',
    'Git dirty/untracked docs are protected; read Git status again before changing them.',
    'Inventory and maintenance ledger themselves may contribute documentation references.',
  ],
  sourceFilesScanned: sources.length, documentCount: entries.length,
  counts, exactDuplicateGroups: duplicates, entries,
};
fs.mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
fs.writeFileSync(path.join(root, output), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ output, documents: entries.length, counts, exactDuplicateGroups: duplicates.length }));
