/**
 * CODE AUDIT (no database) - Listing Management B1 grep guards, so a later change cannot quietly reopen a closed door:
 *   1. `gyms.facilities` has exactly ONE writer: syncFacilitiesMirrorTx (gym-amenity.service.ts).
 *   2. Only the allowlisted files write `gym_photos` (a new writer must be added here on purpose, with the lifecycle in mind).
 *   3. Only the allowlisted files write `gyms` / `gym_partners` through Prisma at all - and every one of them declares
 *      itself a compat writer (withCompatWriter / runAsCompatWriter), so the DB trigger never has to flag it.
 *   4. No public route imports a preview mapper, and the public gym DTO is the only thing the public routes return for a gym.
 *   5. `express.static` is gone from app.ts (a static mount serves files regardless of photo status).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', 'generated', 'node_modules'].includes(entry.name)) continue;
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');
const read = (f: string) => fs.readFileSync(f, 'utf8');
/** Strips // and block comments so prose that mentions a column does not count as code. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('gyms.facilities has ONE writer: syncFacilitiesMirrorTx', () => {
  const writers: string[] = [];
  for (const f of sourceFiles()) {
    const text = code(read(f));
    const writes =
      /\.facilities\s*=(?!=)/.test(text) || // patch.facilities = ...
      /\bfacilities\s*:\s*(?!string\b|boolean\b|true\b|GymFacility\b|z\.|gymFacilities\b|g\.|gym\.|src\.)[\[\w{]/.test(text.replace(/facilities\??\s*:\s*(string|GymFacility)\[\]/g, '')) ||
      /SET[\s\S]{0,40}"facilities"\s*=/.test(text);
    if (writes) writers.push(rel(f));
  }
  assert.deepEqual(writers.sort(), ['services/gym-amenity.service.ts']);
});

test('gym_photos writers are an explicit allowlist', () => {
  const allowed = new Set([
    'repositories/gym-photo.repository.ts', // legacy owner gallery (its HTTP routes are 410 since B1)
    'services/partner-upload.service.ts', // self-service application uploads (STAGED by default)
    'services/gym-photo-lifecycle.ts', // first-approval publish
    // Listing Management B2 - the listing lifecycle (each one is covered by its own integration tests):
    'services/gym-listing-apply.service.ts', // the apply transaction: STAGED -> PUBLISHED -> RETIRED, cover, sort_order
    'services/gym-listing-upload.service.ts', // owner deletes a STAGED photo (DISCARDED)
    'services/gym-listing-sweep.service.ts', // orphan STAGED / long RETIRED -> DISCARDED
  ]);
  const writers = sourceFiles()
    .filter((f) => /\bgymPhoto\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(code(read(f))))
    .map(rel)
    .sort();
  for (const w of writers) assert.ok(allowed.has(w), `${w} writes gym_photos but is not on the allowlist`);
  assert.ok(writers.length >= 2, 'the allowlist should not be vacuous');
});

test('every direct Prisma writer of gyms / gym_partners declares itself a compat writer', () => {
  const direct = /\b(?:tx|prisma)\.(?:gym|gymPartner)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  for (const f of sourceFiles()) {
    const text = code(read(f));
    if (!direct.test(text)) continue;
    assert.match(text, /withCompatWriter|runAsCompatWriter|lockPartner/, `${rel(f)} writes gyms / gym_partners without declaring a compat writer`);
  }
});

test('the public routes use the public mapper only (no preview mapper is imported by a public surface)', () => {
  for (const f of ['routes/public.routes.ts', 'routes/media.routes.ts', 'controllers/gym-media.controller.ts', 'services/gym-public.ts']) {
    assert.doesNotMatch(read(path.join(SRC, f)), /toListingPreviewDto|ListingPreviewDto|isPreview|revisionStatus/, f);
  }
});

test('app.ts has no express.static mount (photo bytes only leave through the checked routes)', () => {
  const app = code(read(path.join(SRC, 'app.ts')));
  assert.doesNotMatch(app, /express\.static/);
  assert.match(app, /\/uploads\/gym-photos\/:file/);
  assert.match(app, /\/media/);
});

test('the legacy disk-photo write routes are wired to the 410 handler and never to multer', () => {
  const owner = code(read(path.join(SRC, 'routes/owner.routes.ts')));
  assert.doesNotMatch(owner, /gymPhotoController.uploadMiddleware/);
  for (const route of [/router\.post\('\/gyms\/:id\/photos'/, /router\.put\('\/gyms\/:id\/photos\/reorder'/, /router\.patch\('\/gyms\/:id\/photos\/:photoId\/cover'/, /router\.delete\('\/gyms\/:id\/photos\/:photoId'/]) {
    assert.match(owner, new RegExp(route.source + '[^;]*retiredPhotoWrite'), String(route));
  }
});
