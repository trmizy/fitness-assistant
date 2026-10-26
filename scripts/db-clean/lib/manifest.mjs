/**
 * db-clean - the approved manifest and its confirmToken (plan 12.15 item 2, the single definition):
 *
 *   approvedManifest = { environment, scriptVersion, hbaSnapshot, aclSnapshot, parameters, allowlist, blockers, tables }
 *   confirmToken     = sha256( canonicalJSON(approvedManifest) )      // EVERYTHING, including every key tuple, pkTypes, rowHash, hba/acl
 *   metadata (auditedAt, operator, pgStat...) lives in a separate file and is NOT part of the token.
 *
 * The token is stable: auditing the same data twice gives the same token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, sha256Hex, readJson, writeJsonAtomic, ensureDir, Refused } from './util.mjs';
import { checkManifestTableConsistency } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');

export const confirmTokenOf = (manifest) => sha256Hex(canonicalJSON(manifest));

/** git sha of the last commit touching scripts/db-clean (or UNCOMMITTED) + sha256 over every script file (tests and docs excluded). */
export function computeScriptVersion(extraFiles = []) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        walk(p);
      } else if (e.name.endsWith('.mjs')) files.push(p);
    }
  };
  walk(TOOL_DIR);
  const lines = files
    .map((f) => `${path.relative(TOOL_DIR, f).split(path.sep).join('/')}:${sha256Hex(fs.readFileSync(f))}`)
    .concat(extraFiles.map((f) => `override:${path.basename(f)}:${sha256Hex(fs.readFileSync(f))}`))
    .sort();
  let gitSha = 'UNCOMMITTED';
  const log = spawnSync('git', ['log', '-1', '--format=%H', '--', 'scripts/db-clean'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const st = spawnSync('git', ['status', '--porcelain', '--', 'scripts/db-clean'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (log.status === 0 && log.stdout.trim() && st.status === 0 && st.stdout.trim() === '') gitSha = log.stdout.trim();
  return { gitSha, filesSha256: sha256Hex(lines.join('\n')) };
}

export function saveCandidate(dir, manifest, token, metadata, base = 'candidate') {
  ensureDir(dir);
  const files = {
    manifest: path.join(dir, `cleanup-manifest.${base}.json`),
    token: path.join(dir, `confirm-token.${base}.txt`),
    metadata: path.join(dir, `cleanup-manifest.${base}.metadata.json`),
  };
  writeJsonAtomic(files.manifest, manifest, { pretty: false });
  fs.writeFileSync(files.token, `${token}\n`);
  writeJsonAtomic(files.metadata, metadata);
  return files;
}

/** Copy a (manifest, token) pair into <dir>/approved/ and make it read-only. Refuses when the token does not match. */
export function approvePair(manifestPath, token, outDir) {
  const manifest = readJson(manifestPath);
  const actual = confirmTokenOf(manifest);
  if (actual !== token) throw new Refused(`confirm token does not match the manifest (token of the file: ${actual})`, 'TOKEN_MISMATCH');
  const dir = ensureDir(path.join(outDir, 'approved'));
  const mf = path.join(dir, 'cleanup-manifest.approved.json');
  const tf = path.join(dir, 'confirm-token.approved.txt');
  for (const f of [mf, tf]) if (fs.existsSync(f)) {
    fs.chmodSync(f, 0o666);
    fs.rmSync(f);
  }
  fs.copyFileSync(manifestPath, mf);
  fs.writeFileSync(tf, `${token}\n`);
  fs.chmodSync(mf, 0o444);
  fs.chmodSync(tf, 0o444);
  return { manifest: mf, token: tf };
}

/**
 * Load a manifest given on the command line: the token must equal --confirm-token, and (for the destructive commands)
 * the file must be the read-only copy produced by `approve` (it lives in a directory named "approved").
 */
export function loadApproved(manifestPath, token, { requireApprovedDir = false } = {}) {
  if (!manifestPath) throw new Refused('--manifest is required', 'BAD_ARGS');
  if (!token) throw new Refused('--confirm-token is required', 'BAD_ARGS');
  if (!fs.existsSync(manifestPath)) throw new Refused(`manifest not found: ${manifestPath}`, 'BAD_ARGS');
  if (requireApprovedDir && path.basename(path.dirname(path.resolve(manifestPath))) !== 'approved') {
    throw new Refused('the manifest must be the approved copy (…/approved/cleanup-manifest.approved.json, made by `approve`)', 'NOT_APPROVED');
  }
  const manifest = readJson(manifestPath);
  const actual = confirmTokenOf(manifest);
  const problems = [];
  if (actual !== token) problems.push(`token mismatch: sha256 of the manifest is ${actual}, the approved token is ${token}`);
  if (requireApprovedDir) {
    // the pair lives in approved/: the token file stored NEXT TO the manifest is what Ngai approved; the command line must agree with it
    const tf = path.join(path.dirname(path.resolve(manifestPath)), 'confirm-token.approved.txt');
    if (!fs.existsSync(tf)) problems.push('approved/confirm-token.approved.txt is missing next to the manifest');
    else if (fs.readFileSync(tf, 'utf8').trim() !== token) problems.push('--confirm-token differs from the token stored in approved/confirm-token.approved.txt (the pair Ngai approved)');
  }
  return { manifest, token, problems };
}

/** Plan 12.15 item 2 steps 2 + 3 (no database needed): internal consistency, and scriptVersion against the running script. */
export function staticChecks(manifest, scriptVersion) {
  const problems = [];
  for (const t of manifest.tables || []) problems.push(...checkManifestTableConsistency(t));
  if (manifest.scriptVersion?.filesSha256 !== scriptVersion.filesSha256) problems.push('scriptVersion.filesSha256 differs from the running script');
  if (manifest.scriptVersion?.gitSha !== scriptVersion.gitSha) problems.push(`scriptVersion.gitSha differs (manifest ${manifest.scriptVersion?.gitSha}, running ${scriptVersion.gitSha})`);
  if (manifest.blockers && Object.values(manifest.blockers).some((v) => (Array.isArray(v) ? v.length : v && Object.keys(v).length))) {
    problems.push('the manifest carries blockers (unclassified tables / missing keys / foreign-key conflicts / cycles) - it cannot be applied');
  }
  return problems;
}

export function svcOfDatname(manifest, datname) {
  const e = manifest.environment.dbs.find((d) => d.datname === datname);
  return e?.svc;
}
