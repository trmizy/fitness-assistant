/**
 * BACKEND INTEGRATION - Listing Management B1, migration `*_amenity_catalog_listing_revisions`.
 *
 * Builds a throw-away "legacy" database on the SAME test server (never the one DATABASE_URL points at): every migration
 * before the new one is applied as raw SQL, then legacy-shaped fixtures are inserted (a gym with all 18 facilities,
 * duplicated array entries, empty arrays, a gym with 3 PUBLISHED covers, a gym with no cover, DRAFT / PENDING_REVIEW /
 * REJECTED gyms with photos, ...). Each scenario then clones that database (CREATE DATABASE ... TEMPLATE) and applies the
 * new migration - or a deliberately broken copy of it - so nothing leaks between scenarios.
 *
 * Applying the file with one simple-protocol query is the same single implicit transaction Prisma uses; the
 * `prisma migrate deploy` / `migrate resolve --rolled-back` / `migrate status` evidence is reported separately.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { guardedTest as test, databaseNameOf, skip } from './test-db-guard';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');
const NEW_SUFFIX = '_amenity_catalog_listing_revisions';
const dirs = fs.readdirSync(MIGRATIONS_DIR).filter((d) => /^\d{14}_/.test(d)).sort();
const NEW_DIR = dirs.find((d) => d.endsWith(NEW_SUFFIX))!;
const MIGRATION_SQL = NEW_DIR ? fs.readFileSync(path.join(MIGRATIONS_DIR, NEW_DIR, 'migration.sql'), 'utf8') : '';

const BASE_DB = databaseNameOf(process.env.DATABASE_URL);
const stem = BASE_DB.replace(/_test$/, '');
const PRE_DB = `${stem}_mig_pre_test`;
const RUN_DB = `${stem}_mig_run_test`;

function urlFor(db: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: urlFor('postgres') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Refuses anything that is not a throw-away derived test database. */
function assertScratch(db: string) {
  assert.ok(db.endsWith('_test') && db !== BASE_DB && db.includes('_mig_'), `refusing to drop ${db}`);
}

async function dropDb(db: string) {
  assertScratch(db);
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`));
}

const FIXTURES = `
INSERT INTO gyms (id, owner_id, name, address, status, updated_at, approved_name, approved_address, facilities, description) VALUES
 ('fx-all18', 'fx-owner-1', 'All 18', 'addr', 'APPROVED', now(), 'All 18', 'addr', ARRAY['FREE_WEIGHTS','CARDIO_MACHINES','FUNCTIONAL_TRAINING_AREA','GROUP_CLASSES','YOGA_STUDIO','SWIMMING_POOL','PERSONAL_TRAINER','INBODY_SCAN','LOCKER_ROOM','SHOWER','SAUNA','TOWEL_SERVICE','PARKING','WIFI','AIR_CONDITIONING','DRINKING_WATER','KIDS_AREA','VENDING_MACHINE']::"GymFacility"[], 'desc all'),
 ('fx-dups', 'fx-owner-2', 'Dups', 'addr', 'APPROVED', now(), 'Dups', 'addr', ARRAY['WIFI','WIFI','PARKING','WIFI']::"GymFacility"[], NULL),
 ('fx-empty', 'fx-owner-3', 'Empty', 'addr', 'PENDING_REVIEW', now(), NULL, NULL, ARRAY[]::"GymFacility"[], NULL),
 ('fx-covers3', 'fx-owner-4', 'Covers3', 'addr', 'APPROVED', now(), 'Covers3', 'addr', ARRAY['SAUNA']::"GymFacility"[], NULL),
 ('fx-nocover', 'fx-owner-5', 'NoCover', 'addr', 'APPROVED', now(), 'NoCover', 'addr', ARRAY[]::"GymFacility"[], NULL),
 ('fx-draft', 'fx-owner-6', 'Draft', '', 'DRAFT', now(), NULL, NULL, ARRAY['SHOWER']::"GymFacility"[], NULL),
 ('fx-pending', 'fx-owner-7', 'Pending', 'addr', 'PENDING_REVIEW', now(), NULL, NULL, ARRAY[]::"GymFacility"[], NULL),
 ('fx-rejected', 'fx-owner-8', 'Rejected', 'addr', 'REJECTED', now(), NULL, NULL, ARRAY[]::"GymFacility"[], NULL),
 ('fx-suspended', 'fx-owner-9', 'Susp', 'addr', 'SUSPENDED', now(), NULL, NULL, ARRAY['WIFI']::"GymFacility"[], NULL),
 ('fx-repending', 'fx-owner-10', 'RePending', 'addr', 'PENDING_REVIEW', now(), 'RePending', 'addr', ARRAY[]::"GymFacility"[], NULL);

INSERT INTO gym_photos (id, gym_id, file_name, sort_order, is_cover, created_at, visibility) VALUES
 ('ph-a1', 'fx-all18', 'a1.jpg', 5, false, '2026-01-03', 'PUBLIC'),
 ('ph-a2', 'fx-all18', 'a2.jpg', 5, true,  '2026-01-02', 'PUBLIC'),
 ('ph-a3', 'fx-all18', 'a3.jpg', 9, false, '2026-01-01', 'PUBLIC'),
 ('ph-c1', 'fx-covers3', 'c1.jpg', 2, true, '2026-02-03', 'PUBLIC'),
 ('ph-c2', 'fx-covers3', 'c2.jpg', 0, true, '2026-02-02', 'PUBLIC'),
 ('ph-c3', 'fx-covers3', 'c3.jpg', 0, true, '2026-02-01', 'PUBLIC'),
 ('ph-c4', 'fx-covers3', 'c4.jpg', 1, false, '2026-02-04', 'PUBLIC'),
 ('ph-n1', 'fx-nocover', 'n1.jpg', 3, false, '2026-03-02', 'PUBLIC'),
 ('ph-n2', 'fx-nocover', 'n2.jpg', 1, false, '2026-03-03', 'PUBLIC'),
 ('ph-d1', 'fx-draft', 'd1.jpg', 0, true, '2026-04-01', 'PRIVATE'),
 ('ph-d2', 'fx-draft', 'd2.jpg', 1, false, '2026-04-02', 'PRIVATE'),
 ('ph-p1', 'fx-pending', 'p1.jpg', 0, true, '2026-04-03', 'PRIVATE'),
 ('ph-r1', 'fx-rejected', 'r1.jpg', 0, true, '2026-04-04', 'PRIVATE'),
 ('ph-s1', 'fx-suspended', 's1.jpg', 0, true, '2026-04-05', 'PUBLIC'),
 ('ph-rp1', 'fx-repending', 'rp1.jpg', 0, true, '2026-04-06', 'PUBLIC');

INSERT INTO gym_partners (id, legal_name, updated_at) VALUES ('fx-partner-1', 'Fx Partner', now());
`;

/** One row per structural/data aspect - equal before and after means a failed migration left NOTHING behind. */
const SNAPSHOT_SQL = `
select 'tables' k, string_agg(table_name, ',' order by table_name) v from information_schema.tables where table_schema='public'
union all select 'gyms_cols', string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='gyms'
union all select 'photos_cols', string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='gym_photos'
union all select 'partners_cols', string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='gym_partners'
union all select 'enums', string_agg(typname, ',' order by typname) from pg_type where typtype='e' and typnamespace='public'::regnamespace
union all select 'enum_PartnerAuditAction', string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='PartnerAuditAction'
union all select 'enum_PartnerReviewCategory', string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='PartnerReviewCategory'
union all select 'funcs', string_agg(proname, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace
union all select 'triggers', string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal
union all select 'indexes', string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname='public'
union all select 'constraints', string_agg(conname, ',' order by conname) from pg_constraint where connamespace='public'::regnamespace
union all select 'temp_tables', count(*)::text from pg_class where relpersistence='t'
union all select 'counts', (select count(*) from gyms)||'/'||(select count(*) from gym_photos)||'/'||(select count(*) from gym_partners)
union all select 'photo_state', string_agg(id||':'||sort_order||':'||is_cover, ',' order by id) from gym_photos
union all select 'gym_state', string_agg(id||':'||status||':'||facilities::text, ',' order by id) from gyms`;

async function snapshot(c: Client): Promise<Record<string, string | null>> {
  const { rows } = await c.query(SNAPSHOT_SQL);
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

async function connectTo(db: string, notices?: string[]): Promise<Client> {
  const c = new Client({ connectionString: urlFor(db) });
  if (notices) c.on('notice', (n) => notices.push(n.message ?? ''));
  await c.connect();
  return c;
}

/** Clones the legacy database, runs `body` against the clone, drops the clone. */
async function inClone<T>(body: (c: Client, notices: string[]) => Promise<T>): Promise<T> {
  await dropDb(RUN_DB);
  await admin((c) => c.query(`CREATE DATABASE "${RUN_DB}" TEMPLATE "${PRE_DB}"`));
  const notices: string[] = [];
  const c = await connectTo(RUN_DB, notices);
  try {
    return await body(c, notices);
  } finally {
    await c.end().catch(() => undefined);
    await dropDb(RUN_DB);
  }
}

async function tryApply(c: Client, sql: string): Promise<string | null> {
  try {
    await c.query(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

test.before(async () => {
  if (skip) return;
  assert.ok(NEW_DIR, 'migration *_amenity_catalog_listing_revisions not found');
  assert.ok(dirs.indexOf(NEW_DIR) === dirs.length - 1, 'the new migration must be the newest one (timestamp rule)');
  await dropDb(PRE_DB);
  await dropDb(RUN_DB);
  await admin((c) => c.query(`CREATE DATABASE "${PRE_DB}"`));
  const c = await connectTo(PRE_DB);
  try {
    for (const dir of dirs) {
      if (dir === NEW_DIR) continue;
      await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    }
    await c.query(FIXTURES);
  } finally {
    await c.end();
  }
});

test.after(async () => {
  if (skip) return;
  await dropDb(RUN_DB);
  await dropDb(PRE_DB);
});

test('migration: applies on legacy-shaped data; every backfill rule holds', async () => {
  await inClone(async (c, notices) => {
    // The legacy public order of the all-18 gym, read BEFORE the migration.
    const pre = await connectTo(PRE_DB);
    const legacyOrder = (
      await pre.query(`SELECT id FROM gym_photos WHERE gym_id = 'fx-all18' ORDER BY is_cover DESC, sort_order, created_at, id`)
    ).rows.map((r) => r.id);
    await pre.end();

    assert.equal(await tryApply(c, MIGRATION_SQL), null);

    // amenities: exactly the 18 SYSTEM rows, slug = enum label.
    const amenities = await c.query(`SELECT slug FROM amenities WHERE source = 'SYSTEM' AND status = 'ACTIVE' ORDER BY slug`);
    assert.equal(amenities.rows.length, 18);
    assert.equal((await c.query(`SELECT count(*)::int n FROM amenities`)).rows[0].n, 18);

    // gym_amenities mirrors gyms.facilities (duplicates collapsed, empty arrays -> no rows).
    const pairs = await c.query(
      `SELECT g.id gym, array_agg(a.slug ORDER BY a.slug) slugs
         FROM gyms g JOIN gym_amenities ga ON ga.gym_id = g.id JOIN amenities a ON a.id = ga.amenity_id GROUP BY g.id`,
    );
    const byGym = Object.fromEntries(pairs.rows.map((r) => [r.gym, r.slugs]));
    assert.equal(byGym['fx-all18'].length, 18);
    assert.deepEqual(byGym['fx-dups'], ['PARKING', 'WIFI']);
    assert.deepEqual(byGym['fx-covers3'], ['SAUNA']);
    assert.deepEqual(byGym['fx-draft'], ['SHOWER']);
    assert.deepEqual(byGym['fx-suspended'], ['WIFI']);
    assert.equal(byGym['fx-empty'], undefined);
    assert.equal(byGym['fx-nocover'], undefined);
    assert.equal((await c.query(`SELECT count(*)::int n FROM gym_amenities`)).rows[0].n, 18 + 2 + 1 + 1 + 1);

    // listing_version / listing_published_at / flow columns.
    const gyms = await c.query(
      `SELECT id, listing_version, listing_published_at, created_flow_version, legacy_no_amenities, legacy_client_at FROM gyms ORDER BY id`,
    );
    const lv = Object.fromEntries(gyms.rows.map((r) => [r.id, r.listing_version]));
    assert.deepEqual(lv, {
      'fx-all18': 1, 'fx-covers3': 1, 'fx-draft': 0, 'fx-dups': 1, 'fx-empty': 0, 'fx-nocover': 1,
      'fx-pending': 0, 'fx-rejected': 0, 'fx-repending': 1, 'fx-suspended': 1,
    });
    for (const r of gyms.rows) {
      assert.equal(r.listing_published_at, null, `${r.id}: legacy listing_published_at stays NULL`);
      assert.equal(r.created_flow_version, null);
      assert.equal(r.legacy_no_amenities, false);
      assert.equal(r.legacy_client_at, null);
    }
    const partner = (await c.query(`SELECT application_flow_version, legacy_no_amenities, legacy_client_at FROM gym_partners WHERE id = 'fx-partner-1'`)).rows[0];
    assert.deepEqual(partner, { application_flow_version: null, legacy_no_amenities: false, legacy_client_at: null });

    // photos: status, gap-free order, exactly one PUBLISHED cover.
    const photos = await c.query(`SELECT id, gym_id, status, sort_order, is_cover, content_hash, retired_at, uploaded_by FROM gym_photos ORDER BY gym_id, sort_order`);
    const status = Object.fromEntries(photos.rows.map((r) => [r.id, r.status]));
    for (const id of ['ph-d1', 'ph-d2', 'ph-p1', 'ph-r1', 'ph-rp1']) assert.equal(status[id], 'STAGED', id);
    for (const id of ['ph-a1', 'ph-a2', 'ph-a3', 'ph-c1', 'ph-c2', 'ph-c3', 'ph-c4', 'ph-n1', 'ph-n2', 'ph-s1']) assert.equal(status[id], 'PUBLISHED', id);
    for (const r of photos.rows) {
      assert.equal(r.content_hash, null);
      assert.equal(r.retired_at, null);
      assert.equal(r.uploaded_by, null);
    }
    const perGym = new Map<string, any[]>();
    for (const r of photos.rows) perGym.set(r.gym_id, [...(perGym.get(r.gym_id) ?? []), r]);
    for (const [gym, rows] of perGym) {
      assert.deepEqual(rows.map((r) => r.sort_order), rows.map((_, i) => i), `${gym}: sort_order 0..n-1`);
    }
    const publishedCovers = (gym: string) => perGym.get(gym)!.filter((r) => r.status === 'PUBLISHED' && r.is_cover).map((r) => r.id);
    assert.deepEqual(publishedCovers('fx-covers3'), ['ph-c3'], 'first by (sort_order, created_at, id) keeps the cover');
    assert.deepEqual(publishedCovers('fx-all18'), ['ph-a2']);
    assert.deepEqual(publishedCovers('fx-nocover'), ['ph-n2'], 'a gym with PUBLISHED photos but no cover gets its first photo as cover');
    assert.deepEqual(publishedCovers('fx-suspended'), ['ph-s1']);
    // The public (PUBLISHED) order of the all-18 gym did not change.
    assert.deepEqual(
      perGym.get('fx-all18')!.map((r) => r.id),
      legacyOrder,
    );

    // NOTICE diagnostics for the cover repair.
    const text = notices.join('\n');
    assert.match(text, /1 gym có hơn 1 ảnh bìa PUBLISHED.*fx-covers3/);
    assert.match(text, /gym fx-covers3: bỏ cờ ảnh bìa của ảnh ph-c1/);
    assert.match(text, /gym fx-covers3: bỏ cờ ảnh bìa của ảnh ph-c2/);
    assert.doesNotMatch(text, /bỏ cờ ảnh bìa của ảnh ph-c3/);
    assert.match(text, /gym fx-nocover: chưa có ảnh bìa, đặt ảnh ph-n2 làm bìa/);

    // The backfill must not have logged compat events (triggers are created last); no temp table survives.
    assert.equal((await c.query(`SELECT count(*)::int n FROM legacy_compat_events`)).rows[0].n, 0);
    assert.equal((await c.query(`SELECT count(*)::int n FROM pg_class WHERE relpersistence = 't'`)).rows[0].n, 0);

    // Defaults for rows created after the migration.
    await c.query(`SET gymini.compat_writer = 'seed'`);
    await c.query(`INSERT INTO gyms (id, owner_id, name, address, updated_at) VALUES ('fx-new', 'o', 'n', 'a', now())`);
    await c.query(`INSERT INTO gym_photos (id, gym_id, file_name) VALUES ('ph-new', 'fx-new', 'x.jpg')`);
    const fresh = (await c.query(`SELECT g.listing_version, p.status, p.is_cover FROM gyms g, gym_photos p WHERE g.id = 'fx-new' AND p.id = 'ph-new'`)).rows[0];
    assert.deepEqual(fresh, { listing_version: 0, status: 'STAGED', is_cover: false });
  });
});

test('migration: the partial unique indexes reject a second PUBLISHED cover and a duplicate STAGED/PUBLISHED hash', async () => {
  await inClone(async (c) => {
    assert.equal(await tryApply(c, MIGRATION_SQL), null);
    await c.query(`SET gymini.compat_writer = 'seed'`);
    await assert.rejects(
      () => c.query(`UPDATE gym_photos SET is_cover = true WHERE id = 'ph-a1'`),
      /gym_photos_one_cover/,
    );
    // A STAGED photo may carry the cover flag without conflict (the index is on PUBLISHED covers only)...
    await c.query(`INSERT INTO gym_photos (id, gym_id, file_name, is_cover, status) VALUES ('ph-x1', 'fx-all18', 'x1.jpg', true, 'STAGED')`);
    // ...and a hash may repeat only across retired/discarded rows or other gyms.
    await c.query(`UPDATE gym_photos SET content_hash = 'h1' WHERE id = 'ph-a1'`);
    await assert.rejects(
      () => c.query(`UPDATE gym_photos SET content_hash = 'h1' WHERE id = 'ph-a3'`),
      /gym_photos_unique_hash/,
    );
    await c.query(`UPDATE gym_photos SET status = 'RETIRED' WHERE id = 'ph-a3'`);
    await c.query(`UPDATE gym_photos SET content_hash = 'h1' WHERE id = 'ph-a3'`);
    await c.query(`UPDATE gym_photos SET content_hash = 'h1' WHERE id = 'ph-s1'`); // another gym
  });
});

test('migration (ii): a failure inside the verification block leaves NOTHING behind (structure, enums, data)', async () => {
  await inClone(async (c) => {
    const before = await snapshot(c);
    // The plan's own failing case: drop one value from the amenities INSERT list.
    const broken = MIGRATION_SQL.split('\n').filter((l) => !l.includes("'amenity-sys-wifi'")).join('\n');
    assert.notEqual(broken, MIGRATION_SQL);
    const message = await tryApply(c, broken);
    assert.match(message ?? '', /GymFacility chưa có đúng 1 amenity tương ứng: WIFI/);
    assert.deepEqual(await snapshot(c), before, 'a rolled-back migration must change nothing');
    assert.equal(before.temp_tables, '0');
  });
});

test('migration (ii): a failure of the cover repair is diagnosed with gym ids - never a bare CREATE UNIQUE INDEX error', async () => {
  await inClone(async (c) => {
    const before = await snapshot(c);
    const broken = MIGRATION_SQL.replace(`UPDATE "gym_photos" SET "is_cover" = false WHERE "id" = r."id";`, 'NULL;');
    assert.notEqual(broken, MIGRATION_SQL);
    const message = await tryApply(c, broken);
    assert.match(message ?? '', /còn 1 gym có hơn 1 ảnh bìa PUBLISHED sau khi sửa \(vd: fx-covers3 \(3 ảnh bìa\)\)/);
    assert.deepEqual(await snapshot(c), before);
  });
});

/** Injects `statement` right before the verification section of the migration. */
function withInjectedBeforeVerification(statement: string): string {
  const marker = '-- ── 8. Verification';
  assert.ok(MIGRATION_SQL.includes(marker));
  return MIGRATION_SQL.replace(marker, `${statement}\n${marker}`);
}

test('migration verification: (a) a missing gym_amenities pair -> "thiếu 1" and the migration rolls back', async () => {
  await inClone(async (c) => {
    const before = await snapshot(c);
    const message = await tryApply(c, withInjectedBeforeVerification(`DELETE FROM gym_amenities WHERE gym_id = 'fx-all18' AND amenity_id = 'amenity-sys-wifi';`));
    assert.match(message ?? '', /gym_amenities lệch facilities — thiếu 1 \(vd: fx-all18:amenity-sys-wifi\), thừa 0/);
    assert.deepEqual(await snapshot(c), before);
  });
});

test('migration verification: (b) an extra pair that is not in facilities -> "thừa 1"', async () => {
  await inClone(async (c) => {
    const message = await tryApply(c, withInjectedBeforeVerification(`INSERT INTO gym_amenities (gym_id, amenity_id) VALUES ('fx-draft', 'amenity-sys-wifi');`));
    assert.match(message ?? '', /thiếu 0 .*thừa 1 \(vd: fx-draft:amenity-sys-wifi\)/s);
  });
});

test('migration verification: (c) one pair swapped for another (same row count) -> flagged in BOTH directions', async () => {
  await inClone(async (c) => {
    const message = await tryApply(
      c,
      withInjectedBeforeVerification(`UPDATE gym_amenities SET amenity_id = 'amenity-sys-yoga-studio' WHERE gym_id = 'fx-dups' AND amenity_id = 'amenity-sys-wifi';`),
    );
    assert.match(message ?? '', /thiếu 1 \(vd: fx-dups:amenity-sys-wifi\), thừa 1 \(vd: fx-dups:amenity-sys-yoga-studio\)/);
  });
});

test('migration verification: counts come from the FULL set - more than 20 mismatches are all counted', async () => {
  await inClone(async (c) => {
    const message = await tryApply(
      c,
      withInjectedBeforeVerification(
        `INSERT INTO gyms (id, owner_id, name, address, updated_at, facilities)
         SELECT 'bulk-' || lpad(g::text, 2, '0'), 'o', 'n', 'a', now(), ARRAY['WIFI']::"GymFacility"[] FROM generate_series(1, 25) g;`,
      ),
    );
    assert.match(message ?? '', /thiếu 25 /, 'LIMIT 20 applies to the printed examples only, never to the count');
    const examples = /thiếu 25 \(vd: ([^)]*)\)/.exec(message ?? '')![1].split(', ');
    assert.equal(examples.length, 20, 'the printed examples are capped at 20');
  });
});
