/**
 * Listing Management B3 - scripts/listing-compat-report.mjs (plan 12.14 item 4, 12.15 items 3-4): the READ-ONLY evidence report for
 * switching LISTING_LEGACY_CLIENT_COMPAT off.
 *
 * Evidence label: BACKEND INTEGRATION - the real script against a real PostgreSQL (`*_test` database). Each scenario builds its own
 * throw-away SCHEMA holding only the tables the report reads (same column names / enum types as the migration), so the verdict of
 * every case is decided by the rows the case writes and not by the shared test database's history; the script's `--schema` option
 * points its search_path there. The data itself is a TEST FIXTURE (timestamps are written directly).
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { guardedTest as test, skip } from './test-db-guard';

const exec = promisify(execFile);
const SCRIPT = path.resolve(__dirname, '../../../../../scripts/listing-compat-report.mjs');
const URL_ = (process.env.DATABASE_URL ?? '').replace(/\?.*$/, '');
let report: any;
const schemas: string[] = [];
let admin: pg.Client;

test.before(async () => {
  if (skip) return;
  report = await import(pathToFileURL(SCRIPT).href);
  admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
});

test.after(async () => {
  if (skip) return;
  for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  await admin.end();
});

/** Builds a schema with the report's tables, lets `fill` insert rows (SQL with now()-relative times), returns the report. */
async function scenario(fill: (q: (sql: string) => Promise<unknown>) => Promise<unknown>) {
  const schema = `b3rep_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  schemas.push(schema);
  const q = async (sql: string) => admin.query(sql);
  await q(`CREATE SCHEMA "${schema}"`);
  await q(`SET search_path TO "${schema}", public`);
  try {
    await q(`CREATE TABLE _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)`);
    await q(`CREATE TABLE gyms (id text PRIMARY KEY, updated_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'), legacy_client_at timestamptz(6))`);
    await q(`CREATE TABLE gym_partners (id text PRIMARY KEY, updated_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'), legacy_client_at timestamptz(6))`);
    await q(`CREATE TABLE legacy_compat_events (LIKE public.legacy_compat_events INCLUDING DEFAULTS)`);
    await q(`CREATE TABLE compat_writer_heartbeats (LIKE public.compat_writer_heartbeats INCLUDING DEFAULTS)`);
    await q(`CREATE TABLE client_compat_events (LIKE public.client_compat_events INCLUDING DEFAULTS)`);
    await q(`INSERT INTO _prisma_migrations VALUES ('20261018155636_amenity_catalog_listing_revisions', now() - interval '30 days', NULL)`);
    await fill(q);
  } finally {
    await q(`SET search_path TO public`);
  }
  const result = await report.runReport(URL_, { schema });
  return { schema, result, text: report.formatReport(result) as string };
}

/** A heartbeat every 10 minutes from `from` to `to` (SQL intervals ago). */
const heartbeats = (from: string, to = '0 minutes') =>
  `INSERT INTO compat_writer_heartbeats (id, instance_id, writer_version, seen_at)
   SELECT gen_random_uuid()::text, 'i-1', 'v1', t FROM generate_series(now() - interval '${from}', now() - interval '${to}', interval '10 minutes') t`;
const event = (outcome: string, action: string, type: string, id: string, ago: string) =>
  `INSERT INTO legacy_compat_events (id, occurred_at, outcome, action, entity_type, entity_id)
   VALUES (gen_random_uuid()::text, now() - interval '${ago}', '${outcome}', '${action}', '${type}', '${id}')`;
const reasonsText = (r: any) => r.reasons.join(' | ');

test('ELIGIBLE: a 20-day window of heartbeats, no legacy activity, no WRITER_ABSENT, only NON_CLIENT seed rows -> prints "ĐỦ ĐIỀU KIỆN" (the report never switches the flag)', async () => {
  const { result, text } = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(event('NON_CLIENT', 'INSERT', 'GYM_PARTNER', 'seed-1', '5 days'));
    await q(`INSERT INTO gyms (id, updated_at) VALUES ('g1', (now() - interval '3 days') AT TIME ZONE 'UTC')`);
  });
  assert.equal(result.eligible, true, result.reasons.join('\n'));
  assert.ok(text.includes('ĐỦ ĐIỀU KIỆN'));
  assert.ok(!text.includes('CHƯA THỂ TẮT CỜ'));
  assert.ok(result.elapsedDays >= 19);
});

test('the writer ran only 3 days (the migration is 30 days old) -> not eligible; the phrase "ĐỦ ĐIỀU KIỆN" is NOT printed', async () => {
  const { result, text } = await scenario(async (q) => q(heartbeats('3 days')));
  assert.equal(result.eligible, false);
  assert.match(reasonsText(result), /Cửa sổ chứng minh mới 3\.\d+ ngày/);
  assert.ok(!text.includes('ĐỦ ĐIỀU KIỆN'), text);
});

test('a WRITER_ABSENT inside the window restarts it (+1 s) -> not eligible; one from before the writer existed does not matter', async () => {
  const inside = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(event('WRITER_ABSENT', 'UPDATE', 'GYM', 'g-x', '2 days'));
  });
  assert.equal(inside.result.eligible, false);
  assert.match(reasonsText(inside.result), /WRITER_ABSENT/);
  const ws = new Date(inside.result.windowStart).getTime();
  assert.ok(Math.abs(Date.now() - ws - 2 * 86_400_000) < 120_000, 'windowStart = last WRITER_ABSENT + 1 s');

  const before = await scenario(async (q) => {
    await q(heartbeats('18 days'));
    await q(event('WRITER_ABSENT', 'UPDATE', 'GYM', 'g-y', '20 days'));
  });
  assert.equal(before.result.eligible, true, before.result.reasons.join('\n'));
});

test('no heartbeat at all -> "không chứng minh được lịch sử triển khai", not eligible', async () => {
  const { result, text } = await scenario(async () => undefined);
  assert.equal(result.eligible, false);
  assert.match(reasonsText(result), /không chứng minh được lịch sử triển khai/i);
  assert.ok(!text.includes('ĐỦ ĐIỀU KIỆN'));
});

test('a 2-hour heartbeat gap in the window while writes happened -> not eligible; the same gap with no write in it is fine', async () => {
  const gapped = (withWrite: boolean) => async (q: (sql: string) => Promise<unknown>) => {
    await q(heartbeats('20 days', '5 days 3 hours'));
    await q(heartbeats('5 days 1 hour'));
    if (withWrite) await q(`INSERT INTO gyms (id, updated_at) VALUES ('g-gap', (now() - interval '5 days 2 hours') AT TIME ZONE 'UTC')`);
  };
  const bad = await scenario(gapped(true));
  assert.equal(bad.result.eligible, false);
  assert.match(reasonsText(bad.result), /Nhịp tim ngắt 12\d phút/);
  assert.equal(bad.result.heartbeatGapsWithWrites.length, 1);
  const fine = await scenario(gapped(false));
  assert.equal(fine.result.eligible, true, fine.result.reasons.join('\n'));
});

test('an application created 60 days ago but RESUBMITTED today by an old client: the activity is dated today, so the report is NOT eligible; the same application last touched before the window does not block', async () => {
  const today = await scenario(async (q) => {
    await q(heartbeats('25 days'));
    await q(`INSERT INTO gym_partners (id, legacy_client_at) VALUES ('p-old', now() - interval '1 minute')`);
    await q(`INSERT INTO legacy_compat_events (id, occurred_at, outcome, action, entity_type, entity_id)
             SELECT gen_random_uuid()::text, legacy_client_at, 'ACCEPTED', 'APPLICATION_RESUBMIT', 'GYM_PARTNER', id FROM gym_partners WHERE id = 'p-old'`);
  });
  assert.equal(today.result.eligible, false);
  assert.match(reasonsText(today.result), /ACCEPTED\/APPLICATION_RESUBMIT=1/);
  assert.match(reasonsText(today.result), /1 hồ sơ \(gym_partners\) có legacy_client_at trong cửa sổ/);
  assert.doesNotMatch(reasonsText(today.result), /không nhất quán/, 'event and legacy_client_at agree - only the activity blocks');

  const control = await scenario(async (q) => {
    await q(heartbeats('15 days'));
    await q(`INSERT INTO gym_partners (id, legacy_client_at) VALUES ('p-old', now() - interval '20 days')`);
    await q(`INSERT INTO legacy_compat_events (id, occurred_at, outcome, action, entity_type, entity_id)
             SELECT gen_random_uuid()::text, legacy_client_at, 'ACCEPTED', 'APPLICATION_SUBMIT', 'GYM_PARTNER', id FROM gym_partners WHERE id = 'p-old'`);
  });
  assert.equal(control.result.eligible, true, control.result.reasons.join('\n'));
});

test('REJECTED_422 has no entity update, is NOT an inconsistency, but being in the window it still makes the report not eligible', async () => {
  const { result } = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(event('REJECTED_422', 'BRANCH_CREATE_QUICK', 'GYM_PARTNER', 'p-none', '1 day'));
  });
  assert.equal(result.eligible, false);
  assert.match(reasonsText(result), /REJECTED_422\/BRANCH_CREATE_QUICK=1/);
  assert.doesNotMatch(reasonsText(result), /không nhất quán/);
  assert.equal(result.acceptedWithoutEntity.length, 0);
  assert.equal(result.entityWithoutEvent.length, 0);
});

test('REJECTED_OTHER (any other 4xx refusal of an old client, e.g. a 400 APPLICATION_INCOMPLETE) is legacy activity: it makes the report not eligible and is NOT an inconsistency (no entity update expected)', async () => {
  const { result, text } = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(event('REJECTED_OTHER', 'APPLICATION_SUBMIT', 'GYM_PARTNER', 'p-400', '1 day'));
  });
  assert.equal(result.eligible, false);
  assert.match(reasonsText(result), /REJECTED_OTHER\/APPLICATION_SUBMIT=1/);
  assert.doesNotMatch(reasonsText(result), /không nhất quán/);
  assert.equal(result.acceptedWithoutEntity.length, 0);
  assert.equal(result.entityWithoutEvent.length, 0);
  assert.ok(!text.includes('ĐỦ ĐIỀU KIỆN'));

  // outside the window it does not count
  const old = await scenario(async (q) => {
    await q(heartbeats('15 days'));
    await q(event('REJECTED_OTHER', 'APPLICATION_SUBMIT', 'GYM_PARTNER', 'p-400', '20 days'));
  });
  assert.equal(old.result.eligible, true, old.result.reasons.join(' | '));
});

test('anti-join, BOTH directions: an ACCEPTED event whose entity has no / an older legacy_client_at, and an entity with legacy_client_at but no ACCEPTED event at that instant -> "dữ liệu không nhất quán"', async () => {
  const eventSide = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(`INSERT INTO gyms (id, legacy_client_at) VALUES ('g-null', NULL)`);
    await q(event('ACCEPTED', 'BRANCH_DRAFT_SAVE', 'GYM', 'g-null', '2 days'));
  });
  assert.equal(eventSide.result.eligible, false);
  assert.match(reasonsText(eventSide.result), /không nhất quán/);
  assert.equal(eventSide.result.acceptedWithoutEntity.length, 1);
  assert.equal(eventSide.result.acceptedWithoutEntity[0].entity_id, 'g-null');

  const entitySide = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(`INSERT INTO gym_partners (id, legacy_client_at) VALUES ('p-orphan', now() - interval '3 days')`);
  });
  assert.equal(entitySide.result.eligible, false);
  assert.match(reasonsText(entitySide.result), /không nhất quán/);
  assert.equal(entitySide.result.entityWithoutEvent.length, 1);
  assert.equal(entitySide.result.entityWithoutEvent[0].entity_type, 'GYM_PARTNER');

  // an event and an entity that disagree by a moment (not the same instant) are inconsistent in the reverse direction
  const skew = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(`INSERT INTO gyms (id, legacy_client_at) VALUES ('g-skew', now() - interval '1 day' + interval '2 seconds')`);
    await q(event('ACCEPTED', 'BRANCH_DRAFT_SAVE', 'GYM', 'g-skew', '1 day'));
  });
  assert.equal(skew.result.entityWithoutEvent.length, 1);
});

test('client_compat_events telemetry in the window also blocks (secondary source)', async () => {
  const { result } = await scenario(async (q) => {
    await q(heartbeats('20 days'));
    await q(`INSERT INTO client_compat_events (id, route, outcome, created_at) VALUES (gen_random_uuid()::text, 'PUT /x', 'REVIEW_REQUIRED_409', now() - interval '2 days')`);
  });
  assert.equal(result.eligible, false);
  assert.match(reasonsText(result), /REVIEW_REQUIRED_409=1/);
});

test('the script is READ ONLY: every statement is a SELECT / WITH, one BEGIN READ ONLY transaction that is rolled back, nothing else', async () => {
  for (const [name, sql] of Object.entries(report.QUERIES as Record<string, string>)) {
    assert.match(sql, /^\s*(SELECT|WITH)\b/i, name);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i, name);
  }
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /BEGIN READ ONLY/);
  assert.match(src, /ROLLBACK/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /\bclient\.query\(\s*['"`](?!BEGIN READ ONLY|ROLLBACK|SET LOCAL search_path)/);

  // and the database refuses a write inside the transaction the script uses
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await assert.rejects(() => c.query(`INSERT INTO compat_writer_heartbeats (id, instance_id, writer_version) VALUES ('x','x','v1')`), /read-only transaction/);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
});

test('CLI: DATABASE_URL as the first argument; exit code 0 + "ĐỦ ĐIỀU KIỆN" when eligible, exit 3 and no such phrase when not; --json is machine readable', async () => {
  const ok = await scenario(async (q) => q(heartbeats('20 days')));
  const run = (schema: string, extra: string[] = []) =>
    exec(process.execPath, [SCRIPT, URL_, `--schema=${schema}`, ...extra]).then(
      (r) => ({ code: 0, out: r.stdout }),
      (e) => ({ code: e.code as number, out: String(e.stdout) }),
    );
  const good = await run(ok.schema);
  assert.equal(good.code, 0);
  assert.ok(good.out.includes('ĐỦ ĐIỀU KIỆN'));

  const bad = await scenario(async (q) => q(heartbeats('2 days')));
  const notOk = await run(bad.schema);
  assert.equal(notOk.code, 3);
  assert.ok(!notOk.out.includes('ĐỦ ĐIỀU KIỆN'), notOk.out);

  const json = await run(bad.schema, ['--json']);
  assert.equal(JSON.parse(json.out).eligible, false);

  const noUrl = await exec(process.execPath, [SCRIPT], { env: { ...process.env, DATABASE_URL: '' } }).then(() => 0, (e) => e.code as number);
  assert.equal(noUrl, 1, 'a missing DATABASE_URL is an error, not a verdict');
});
