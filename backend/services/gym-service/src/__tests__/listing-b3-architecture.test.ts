/**
 * Listing Management B3 - source-text (CI grep) guards for the legacy-client evidence (plan 12.14 item 4, 12.15 item 3):
 * every handler that must leave a `legacy_compat_events` row calls recordLegacyCompatTx (directly or through the one helper that
 * does), and nothing else writes that table. Evidence label: CODE AUDIT (reads the source, no database).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

/** Text of `  async <name>(` up to the next sibling member of the same object literal (or the end of the file). */
function method(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  assert.ok(start >= 0, `method ${name} not found`);
  const rest = source.slice(start + 10);
  const next = rest.search(/\n {2}(async \w+\(|\/\*\*|\w+\()/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 10 + next);
}
function fn(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end < 0 ? undefined : end);
}

test('application service: every handler that the plan lists reaches recordLegacyCompatTx (through finishApplicationTx / saveStep / recordNoop, which are themselves checked)', () => {
  const s = read('services/partner-application.service.ts');
  // the helper chain
  assert.match(fn(s, 'export async function finishApplicationTx('), /recordLegacyCompatTx\(/);
  assert.match(fn(s, 'function saveStep<T>('), /finishApplicationTx\(/);
  assert.match(fn(s, 'async function recordNoop('), /finishApplicationTx\(/);
  assert.match(fn(s, 'async function recordRejectedAmenities('), /recordLegacyRejectedEvent\(/);
  // APPLICATION_BOOTSTRAP, APPLICATION_SAVE_STEP (every PUT step), APPLICATION_SUBMIT, APPLICATION_RESUBMIT
  const reach = /(recordLegacyCompatTx\(|finishApplicationTx\(|saveStep\(|recordNoop\()/;
  for (const name of ['bootstrap', 'updateRepresentative', 'updateBusinessScale', 'upsertBrand', 'updateSocialLinks', 'upsertBranch', 'updateLegal', 'saveAmenities', 'submit', 'resubmit']) {
    assert.match(method(s, name), reach, `partnerApplicationService.${name} must leave legacy-compat evidence`);
  }
  assert.match(method(s, 'bootstrap'), /'APPLICATION_BOOTSTRAP'/);
  assert.match(method(s, 'submit'), /'APPLICATION_SUBMIT'/);
  assert.match(method(s, 'resubmit'), /'APPLICATION_RESUBMIT'/);
  // the two that can refuse with 422 also write the REJECTED_422 row
  for (const name of ['submit', 'resubmit']) assert.match(method(s, name), /recordRejectedAmenities\(/, name);
  // PUT /owner/application/photos/reorder is a save step too
  assert.match(method(read('services/partner-upload.service.ts'), 'reorderPhotos'), /finishApplicationTx\(/);
});

test('every PUT route of /owner/application hands the request headers (listingCompatOf) to its service', () => {
  const routes = read('routes/application.routes.ts');
  const controller = read('controllers/application.controller.ts');
  const puts = [...routes.matchAll(/router\.put\([^\n]*applicationController\.(\w+)\)/g)].map((m) => m[1]);
  assert.ok(puts.length >= 8, `found ${puts.join(',')}`);
  for (const name of puts) {
    const start = controller.indexOf(`\n  ${name}: handler(`);
    assert.ok(start >= 0, name);
    const end = controller.indexOf('\n\n', start);
    assert.match(controller.slice(start, end < 0 ? undefined : end), /listingCompatOf\(req\)/, `controller ${name}`);
  }
  for (const name of ['bootstrap', 'submit', 'resubmit', 'get']) {
    const start = controller.indexOf(`\n  ${name}: handler(`);
    assert.ok(start >= 0, name);
    assert.match(controller.slice(start, controller.indexOf('\n\n', start)), /listingCompatOf\(req\)/, `controller ${name}`);
  }
});

test('branch paths: createGym, createDraft, updateDraft and submitForReview each call recordLegacyCompatTx (createDraft / updateDraft / submitForReview through acceptedEvent), and the refusals write REJECTED_422', () => {
  const draft = read('services/gym-draft.service.ts');
  assert.match(fn(draft, 'function acceptedEvent('), /recordLegacyCompatTx\(/);
  assert.match(method(draft, 'createDraft'), /acceptedEvent\([^)]*'BRANCH_DRAFT_CREATE'/);
  assert.match(method(draft, 'updateDraft'), /acceptedEvent\([^)]*'BRANCH_DRAFT_SAVE'/);
  assert.match(method(draft, 'submitForReview'), /acceptedEvent\([^)]*'BRANCH_DRAFT_SUBMIT'/);
  assert.match(method(draft, 'submitForReview'), /recordLegacyRejectedEvent\(/);

  const gym = read('services/gym.service.ts');
  const create = method(gym, 'createGym');
  assert.match(create, /recordLegacyCompatTx\(/);
  assert.match(create, /'BRANCH_CREATE_QUICK'/);
  assert.match(create, /recordLegacyRejectedEvent\(/);

  // and their controllers pass the request's headers
  assert.match(read('controllers/gym.controller.ts'), /gymService\.createGym\([^)]*listingCompatOf\(req\)/);
  const dc = read('controllers/gym-draft.controller.ts');
  for (const call of ['createDraft', 'updateDraft', 'submitForReview']) assert.match(dc, new RegExp(`gymDraftService\\.${call}\\([^;]*listingCompatOf\\(req\\)`), call);
});

test('legacy_compat_events has ONE application writer (legacy-compat.service.ts); a new client (header >= 2) is a no-op there; the REJECTED outcome never updates an entity', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'generated') continue;
        walk(p);
      } else if (/\.ts$/.test(e.name) && e.name !== 'legacy-compat.service.ts') {
        const t = fs.readFileSync(p, 'utf8');
        if (/INSERT INTO legacy_compat_events|legacyCompatEvent\.(create|createMany|upsert|update|delete)/.test(t)) offenders.push(path.relative(SRC, p));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], 'only recordLegacyCompatTx may write the event log');

  const s = read('services/legacy-compat.service.ts');
  const rec = fn(s, 'export async function recordLegacyCompatTx(');
  assert.match(rec, /isNewClientFlowHeader\(e\.flowHeader\)\) return false/);
  assert.match(rec, /withCompatWriter\(tx\)/);
  assert.match(rec, /if \(e\.outcome === 'ACCEPTED'\)/, 'the entity update is ACCEPTED-only');
  assert.match(fn(s, 'export async function recordLegacyRejectedEvent('), /prisma\.\$transaction\(/, 'REJECTED_422 has its own transaction');
});

test('the refusal guard is mounted at app level BEFORE the body parser and covers every compat action of plan 12.14 item 4', () => {
  const app = read('app.ts');
  assert.ok(app.indexOf('app.use(legacyCompatRefusalGuard)') > 0);
  assert.ok(app.indexOf('app.use(legacyCompatRefusalGuard)') < app.indexOf('app.use(express.json())'));
  const s = read('services/legacy-compat.service.ts');
  for (const action of ['APPLICATION_BOOTSTRAP', 'APPLICATION_SAVE_STEP', 'APPLICATION_SUBMIT', 'APPLICATION_RESUBMIT', 'BRANCH_CREATE_QUICK', 'BRANCH_DRAFT_CREATE', 'BRANCH_DRAFT_SAVE', 'BRANCH_DRAFT_SUBMIT']) {
    assert.match(s, new RegExp(`action: '${action}',\\s+entity:`), action);
  }
  // the guard writes through recordLegacyRejectedEvent (own transaction, errors logged not thrown) with the REJECTED_OTHER outcome
  assert.match(fn(s, 'export function legacyCompatRefusalGuard('), /recordLegacyRejectedEvent\([\s\S]*'REJECTED_OTHER'/);
  assert.match(fn(s, 'export async function recordLegacyRejectedEvent('), /catch \(error\)[\s\S]*logger\.error/);
});
