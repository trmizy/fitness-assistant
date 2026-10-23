/**
 * Listing Management B1 (plan 12.15 item 5) - the CONTRACT between the `GymFacility` Prisma enum, the amenity catalogue's
 * SYSTEM rows and the two client label tables. It fails the moment somebody adds an enum value but forgets the
 * migration mapping, the code constant or a label - no reliance on the old migration.
 *
 *   Part 1 (always runs, no database): Prisma enum == SYSTEM_AMENITY_SLUGS == GYM_FACILITY_VALUES (zod) == keys of
 *          FACILITY_LABEL on web (StepFacilities.tsx) and mobile (gymDirectory.ts) - the two frontend files are read as
 *          SOURCE TEXT, never imported - and the Vietnamese names match the seeds.
 *   Part 2 (needs a `*_test` database, via test-db-guard): after `prisma migrate deploy`, the SYSTEM rows of `amenities`
 *          are exactly the enum values with the seeded attributes, and the migration's own verification DO block, re-run
 *          against the live data, passes - and fails in the three mismatch shapes (missing / extra / swapped pair).
 *
 * Evidence labels: Part 1 = CODE AUDIT; Part 2 = BACKEND INTEGRATION.
 */
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { GymFacility } from '../generated/prisma';
import { GYM_FACILITY_VALUES } from '../schemas/gym.schemas';
import {
  AMENITY_CATEGORIES,
  AMENITY_ICON_KEYS,
  SYSTEM_AMENITY_SEEDS,
  SYSTEM_AMENITY_SLUGS,
  normalizeAmenityName,
} from '../services/amenity-catalog';
import { guardedTest, skip } from './test-db-guard';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const WEB_LABELS = path.join(REPO_ROOT, 'frontend/web/src/app/components/gym/AddBranchWizard/StepFacilities.tsx');
const MOBILE_LABELS = path.join(REPO_ROOT, 'frontend/mobile/src/features/services/gymDirectory.ts');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

/** Reads `FACILITY_LABEL ... = { KEY: "label", ... };` out of a source file as text. */
function readFacilityLabels(file: string): Record<string, string> {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.search(/export const FACILITY_LABEL\b/);
  assert.ok(start >= 0, `FACILITY_LABEL not found in ${file}`);
  const open = src.indexOf('{', src.indexOf('=', start));
  const close = src.indexOf('};', open);
  assert.ok(open > 0 && close > open, `FACILITY_LABEL literal not found in ${file}`);
  const labels: Record<string, string> = {};
  for (const m of src.slice(open + 1, close).matchAll(/^\s*([A-Z][A-Z_]*)\s*:\s*"([^"]*)"\s*,?\s*$/gm)) labels[m[1]] = m[2];
  return labels;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

// ── Part 1: no database ────────────────────────────────────────────────────────────────────

nodeTest('contract: Prisma GymFacility enum == SYSTEM_AMENITY_SLUGS == zod GYM_FACILITY_VALUES', () => {
  const enumValues = Object.values(GymFacility) as string[];
  assert.equal(enumValues.length, 18);
  assert.deepEqual(sorted(SYSTEM_AMENITY_SLUGS), sorted(enumValues));
  assert.deepEqual(sorted(GYM_FACILITY_VALUES), sorted(enumValues));
  assert.equal(new Set(SYSTEM_AMENITY_SLUGS).size, SYSTEM_AMENITY_SLUGS.length, 'a slug is duplicated in SYSTEM_AMENITY_SEEDS');
});

nodeTest('contract: web FACILITY_LABEL keys == enum, and each label == the seeded Vietnamese name', () => {
  const labels = readFacilityLabels(WEB_LABELS);
  assert.deepEqual(sorted(Object.keys(labels)), sorted(SYSTEM_AMENITY_SLUGS), 'web label table drifted from the GymFacility enum');
  for (const seed of SYSTEM_AMENITY_SEEDS) assert.equal(labels[seed.slug], seed.name, `web label of ${seed.slug}`);
});

nodeTest('contract: mobile FACILITY_LABEL keys == enum, and each label == the seeded Vietnamese name', () => {
  const labels = readFacilityLabels(MOBILE_LABELS);
  assert.deepEqual(sorted(Object.keys(labels)), sorted(SYSTEM_AMENITY_SLUGS), 'mobile label table drifted from the GymFacility enum');
  for (const seed of SYSTEM_AMENITY_SEEDS) assert.equal(labels[seed.slug], seed.name, `mobile label of ${seed.slug}`);
});

nodeTest('contract: seeds use a known category, an allowlisted icon, unique names (also once normalised)', () => {
  const names = new Set<string>();
  for (const s of SYSTEM_AMENITY_SEEDS) {
    assert.ok((AMENITY_CATEGORIES as readonly string[]).includes(s.category), `${s.slug}: category`);
    assert.ok(AMENITY_ICON_KEYS.includes(s.iconKey), `${s.slug}: icon`);
    const n = normalizeAmenityName(s.name);
    assert.ok(!names.has(n), `${s.slug}: normalised name collides`);
    names.add(n);
  }
});

nodeTest('normalizeAmenityName: accents, case, spacing and đ all fold together', () => {
  assert.equal(normalizeAmenityName('Phòng boxing'), normalizeAmenityName('  phong   BOXING '));
  assert.equal(normalizeAmenityName('Đường chạy'), 'duong chay');
  assert.notEqual(normalizeAmenityName('Phòng boxing'), normalizeAmenityName('Phòng yoga'));
});

// ── Part 2: database (test DB only) ────────────────────────────────────────────────────────

function migrationVerificationBlock(): string {
  const dir = fs.readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith('_amenity_catalog_listing_revisions'));
  assert.ok(dir, 'migration *_amenity_catalog_listing_revisions not found');
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
  const section = sql.slice(sql.indexOf('-- ── 8. Verification'), sql.indexOf('-- ── 9. Compat-writer triggers'));
  const block = section.match(/DO \$\$[\s\S]*?END \$\$;/);
  assert.ok(block, 'verification DO block not found in the migration');
  return block[0];
}

let client: Client | null = null;

guardedTest.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});
guardedTest.after(async () => {
  await client?.end();
});

guardedTest('contract (DB): amenities SYSTEM rows are exactly the enum values with the seeded attributes', async () => {
  const { rows } = await client!.query(
    `SELECT slug, name, name_normalized, category::text, icon_key, sort_order, source::text, status::text
       FROM amenities WHERE source = 'SYSTEM' ORDER BY slug`,
  );
  assert.deepEqual(rows.map((r) => r.slug), sorted(Object.values(GymFacility) as string[]));
  for (const seed of SYSTEM_AMENITY_SEEDS) {
    const row = rows.find((r) => r.slug === seed.slug)!;
    assert.equal(row.name, seed.name, `${seed.slug}: name`);
    assert.equal(row.name_normalized, normalizeAmenityName(seed.name), `${seed.slug}: name_normalized`);
    assert.equal(row.category, seed.category, `${seed.slug}: category`);
    assert.equal(row.icon_key, seed.iconKey, `${seed.slug}: icon_key`);
    assert.equal(row.sort_order, seed.sortOrder, `${seed.slug}: sort_order`);
    assert.equal(row.status, 'ACTIVE', `${seed.slug}: status`);
  }
});

/**
 * Runs `setup` then the migration's verification DO block in a transaction that is ALWAYS rolled back.
 * `isolated` shadows `gyms`, `gym_amenities` and `amenities` with TEMP tables (pg_temp is searched first) holding only
 * this test's own gym, so the mismatch assertions cannot be disturbed by rows other test files have in flight.
 */
async function runVerification(
  setup: (c: Client, gymId: string) => Promise<void>,
  isolated = true,
): Promise<{ ok: boolean; message: string }> {
  const gymId = `contract-${randomUUID()}`;
  const c = client!;
  await c.query('BEGIN');
  try {
    if (isolated) {
      await c.query(`CREATE TEMP TABLE amenities ON COMMIT DROP AS SELECT id, slug FROM public.amenities`);
      await c.query(`CREATE TEMP TABLE gyms (id text, facilities "GymFacility"[]) ON COMMIT DROP`);
      await c.query(`CREATE TEMP TABLE gym_amenities (gym_id text, amenity_id text) ON COMMIT DROP`);
      await c.query(`INSERT INTO gyms VALUES ($1, ARRAY['WIFI','PARKING','SAUNA']::"GymFacility"[])`, [gymId]);
    } else {
      await c.query(`SET LOCAL gymini.compat_writer = 'seed'`);
      await c.query(
        `INSERT INTO gyms (id, owner_id, name, address, updated_at, facilities)
         VALUES ($1, $2, 'Contract gym', 'addr', now(), ARRAY['WIFI','PARKING','SAUNA']::"GymFacility"[])`,
        [gymId, `owner-${gymId}`],
      );
    }
    await c.query(
      `INSERT INTO gym_amenities (gym_id, amenity_id)
       SELECT $1, id FROM amenities WHERE slug IN ('WIFI','PARKING','SAUNA')`,
      [gymId],
    );
    await setup(c, gymId);
    await c.query(migrationVerificationBlock());
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    await c.query('ROLLBACK');
  }
}

guardedTest('contract (DB): the migration verification block passes on consistent data (isolated)', async () => {
  assert.deepEqual(await runVerification(async () => {}), { ok: true, message: '' });
});

guardedTest('contract (DB): the migration verification block passes on the LIVE test data (gyms.facilities == gym_amenities)', async () => {
  assert.deepEqual(await runVerification(async () => {}, false), { ok: true, message: '' });
});

guardedTest('contract (DB): (a) one gym_amenities pair removed -> "thiếu 1", nothing extra', async () => {
  const result = await runVerification(async (c, gymId) => {
    await c.query(`DELETE FROM gym_amenities WHERE gym_id = $1 AND amenity_id = 'amenity-sys-wifi'`, [gymId]);
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /thiếu 1 .*thừa 0/s);
  assert.match(result.message, /amenity-sys-wifi/);
});

guardedTest('contract (DB): (b) a pair that is not in facilities -> "thừa 1"', async () => {
  const result = await runVerification(async (c, gymId) => {
    await c.query(`INSERT INTO gym_amenities (gym_id, amenity_id) VALUES ($1, 'amenity-sys-yoga-studio')`, [gymId]);
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /thiếu 0 .*thừa 1/s);
});

guardedTest('contract (DB): (c) one pair swapped for another (same count) -> flagged in BOTH directions', async () => {
  const result = await runVerification(async (c, gymId) => {
    await c.query(`UPDATE gym_amenities SET amenity_id = 'amenity-sys-yoga-studio' WHERE gym_id = $1 AND amenity_id = 'amenity-sys-wifi'`, [gymId]);
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /thiếu 1 .*thừa 1/s);
});

guardedTest('contract (DB): a missing SYSTEM amenity row -> the enum mapping check names it', async () => {
  const result = await runVerification(async (c, gymId) => {
    await c.query(`DELETE FROM gym_amenities WHERE gym_id = $1`, [gymId]);
    await c.query(`UPDATE gyms SET facilities = ARRAY[]::"GymFacility"[] WHERE id = $1`, [gymId]);
    await c.query(`UPDATE amenities SET slug = 'RENAMED_WIFI' WHERE slug = 'WIFI'`); // the shadowing TEMP copy only
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /GymFacility chưa có đúng 1 amenity tương ứng: WIFI/);
});
