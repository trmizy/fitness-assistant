/**
 * [REGRESSION D48-INVARIANT] CODE AUDIT (a grep-style unit test, no database).
 *
 * D48 is a financial invariant: the platform never fronts money, no PartnerReceivable is created by a ledger path, and
 * pooled AVAILABLE is never drawn for a contract / personalized / membership operation. The LEDGER_STRICT_OWN_FUNDS
 * switch was removed. This test fails if any of that comes back in production source:
 *   - `coverShortfall` must not appear anywhere in payment-service source (comments in tests excepted);
 *   - `partnerReceivable.create` / `createMany` / `upsert` must not appear in src/ (non-test) or scripts/ - OLD rows are
 *     only read / recovered / settled (update), never created;
 *   - nothing may read LEDGER_STRICT_OWN_FUNDS; the only mention allowed is the "flag removed" warning in
 *     contract-request-guard.ts;
 *   - no compose / env example / infra file in the repository sets it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { warnIfRemovedOwnFundsFlagSet } from '../services/contract-request-guard';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(SERVICE_ROOT, '..', '..', '..');

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

const isTs = (f: string) => f.endsWith('.ts') || f.endsWith('.js');
const isTest = (f: string) => f.includes(`${path.sep}__tests__${path.sep}`);
const productionSources = [
  ...walk(path.join(SERVICE_ROOT, 'src'), (f) => isTs(f) && !isTest(f)),
  ...walk(path.join(SERVICE_ROOT, 'scripts'), isTs),
];
const rel = (f: string) => path.relative(SERVICE_ROOT, f).split(path.sep).join('/');
const read = (f: string) => fs.readFileSync(f, 'utf8');

test('[REGRESSION D48-INVARIANT] the scan really covers the ledger services', () => {
  const names = productionSources.map(rel);
  for (const must of ['src/services/contract-ledger.service.ts', 'src/services/membership-ledger.service.ts', 'src/services/personalized-service-ledger.service.ts']) {
    assert.ok(names.includes(must), `${must} is scanned`);
  }
});

test('[REGRESSION D48-INVARIANT] coverShortfall does not exist in production source', () => {
  const hits = productionSources.filter((f) => /coverShortfall/.test(read(f))).map(rel);
  assert.deepEqual(hits, []);
});

test('[REGRESSION D48-INVARIANT] no production code creates a PartnerReceivable (old rows are only recovered / settled)', () => {
  const pattern = /partnerReceivable\s*\.\s*(create|createMany|upsert)\b/;
  const hits = productionSources.filter((f) => pattern.test(read(f))).map(rel);
  assert.deepEqual(hits, [], 'allowed places: none');
});

test('[REGRESSION D48-INVARIANT] nothing reads LEDGER_STRICT_OWN_FUNDS; only the removed-flag warning mentions it', () => {
  const hits = productionSources.filter((f) => /LEDGER_STRICT_OWN_FUNDS/.test(read(f))).map(rel);
  assert.deepEqual(hits, ['src/services/contract-request-guard.ts']);
  const guard = read(path.join(SERVICE_ROOT, 'src/services/contract-request-guard.ts'));
  assert.ok(!/process\.env\.LEDGER_STRICT_OWN_FUNDS\s*(\?\?|\|\||===|!==|==|!=)/.test(guard), 'the guard only checks "is it set", it never branches on its value');
  assert.ok(!productionSources.some((f) => /ledgerStrictOwnFunds\s*\(/.test(read(f))), 'the old reader function is gone');
});

test('[REGRESSION D48-INVARIANT] no compose / env example / infra file in the repository sets LEDGER_STRICT_OWN_FUNDS', () => {
  const roots = [
    ...fs.readdirSync(REPO_ROOT).filter((n) => /^docker-compose.*\.ya?ml$/.test(n) || /^\.env/.test(n)).map((n) => path.join(REPO_ROOT, n)),
    ...walk(path.join(REPO_ROOT, 'infra'), (f) => !/\.(png|jpg|jpeg|gif|zip|exe)$/i.test(f)),
    ...walk(path.join(REPO_ROOT, 'docker'), (f) => !/\.(png|jpg|jpeg|gif|zip|exe)$/i.test(f)),
    ...walk(path.join(SERVICE_ROOT), (f) => /(^|[\/])(\.env\.example|Dockerfile[^\/]*)$/.test(f)),
  ];
  // Only file NAMES that end in ".example" are read among the .env* files: real .env files are never opened.
  const readable = roots.filter((f) => !path.basename(f).startsWith('.env') || f.endsWith('.example'));
  const hits = readable.filter((f) => fs.statSync(f).isFile() && /LEDGER_STRICT_OWN_FUNDS/.test(read(f))).map((f) => path.relative(REPO_ROOT, f));
  assert.deepEqual(hits, []);
});

test('[REGRESSION D48-INVARIANT] setting the removed flag only warns - it never changes behaviour', () => {
  assert.equal(warnIfRemovedOwnFundsFlagSet({} as NodeJS.ProcessEnv), false, 'unset: silent');
  for (const v of ['false', 'FALSE', '0', 'garbage', '', 'true']) {
    assert.equal(warnIfRemovedOwnFundsFlagSet({ LEDGER_STRICT_OWN_FUNDS: v } as unknown as NodeJS.ProcessEnv), true, `"${v}": warned, nothing else`);
  }
});
