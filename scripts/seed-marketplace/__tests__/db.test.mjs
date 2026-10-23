// BACKEND INTEGRATION on the isolated test container (localhost:55433, gymcoach_<svc>_seed_test, migrated with `prisma migrate deploy`).
// Skipped (not failed) when the container is unreachable. Never touches a dev DB: assertSeedAllowed() is called first.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSeedAllowed, resolveTarget } from "../lib/guard.mjs";
import { assertNoCollisions, closePools, makePools, runTierA, seedCounts, SeedCollisionError, authUserRows, profileRows } from "../lib/tierA.mjs";
import { runIntegrity } from "../lib/integrity.mjs";
import { buildWorld } from "../lib/world/index.mjs";

const target = resolveTarget({ kind: "test" });
assertSeedAllowed(target, { reseed: true });
const pools = makePools(target);
let reachable = true;
try {
  await pools.auth.query("SELECT 1");
  await pools.payment.query("SELECT 1");
} catch {
  reachable = false;
}
const opts = { skip: reachable ? false : "test container not reachable" };
const world = buildWorld();
test.after(() => closePools(pools));

test("Tier A is idempotent: three runs -> identical row counts", opts, async () => {
  const counts = [];
  for (let i = 0; i < 3; i++) {
    await runTierA(pools, world);
    counts.push(await seedCounts(pools));
  }
  assert.deepEqual(counts[1], counts[0]);
  assert.deepEqual(counts[2], counts[0]);
  assert.equal(counts[0]["auth.users"], world.clients.length + world.pts.length);
  assert.equal(counts[0]["user.user_profiles"], world.clients.length + world.pts.length);
  assert.equal(counts[0]["user.inbody_entries"], world.clients.reduce((n, c) => n + c.inbody.length, 0));
  assert.equal(counts[0]["auth.users[GYM_OWNER]"], 0, "owners are NOT created by Tier A");
});

test("seed rows are well-formed: bcrypt hash, natural names, role CUSTOMER, profile isPT=false", opts, async () => {
  const { rows } = await pools.auth.query(`SELECT email, password, "firstName", "lastName", role::text AS role FROM users WHERE email = 'tran-minh-khoa@seed.gymini.test'`);
  assert.equal(rows.length, 1);
  assert.match(rows[0].password, /^\$2[aby]\$10\$/);
  assert.equal(`${rows[0].firstName} ${rows[0].lastName}`, "Trần Minh Khoa");
  assert.equal(rows[0].role, "CUSTOMER");
  const p = await pools.user.query(`SELECT "isPT", pt_suspended FROM user_profiles WHERE email = 'tran-minh-khoa@seed.gymini.test'`);
  assert.deepEqual(p.rows[0], { isPT: false, pt_suspended: false });
});

test("integrity checks pass (or are N/A before Tier B) on the freshly seeded DBs", opts, async () => {
  const results = await runIntegrity(pools);
  const bad = results.filter((r) => r.status === "FAIL" || r.status === "ERROR");
  assert.deepEqual(bad, []);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.equal(byName["auth role <-> user_profiles.is_pt"].status, "PASS");
  assert.equal(byName["auth role <-> user_profiles.is_pt"].examined, world.clients.length + world.pts.length);
  assert.equal(byName["one Brand per Gym Owner (and per partner)"].status, "N/A");
});

test("collision: a planned e-mail owned by someone else stops the run and nothing is written", opts, async () => {
  const victim = world.clients[5];
  const before = await seedCounts(pools);
  const rogueEmail = "rogue-collision@seed.gymini.test";
  // an account that is NOT ours but sits on a planned address: emulate by re-pointing the planned e-mail of one client at a foreign row
  await pools.auth.query(`INSERT INTO users (id, email, password, role, "updatedAt") VALUES ('foreign-id-1', $1, 'x', 'CUSTOMER', now())`, [rogueEmail]);
  try {
    const w2 = { ...world, clients: world.clients.map((c, i) => (i === 5 ? { ...c, profile: { ...c.profile, email: rogueEmail } } : c)) };
    await assert.rejects(() => assertNoCollisions(pools, w2), (e) => e instanceof SeedCollisionError && /already belong to other accounts/.test(e.message));
    await assert.rejects(() => runTierA(pools, w2), SeedCollisionError);
    assert.equal(victim.slug.length > 0, true);
  } finally {
    await pools.auth.query(`DELETE FROM users WHERE id = 'foreign-id-1'`);
  }
  const after = await seedCounts(pools);
  assert.deepEqual(after, before);
});

test("collision: a non-seed (preserved-account style) e-mail in the plan is refused", opts, async () => {
  const w2 = { ...world, clients: [{ ...world.clients[0], profile: { ...world.clients[0].profile, email: "admin@example.com" } }, ...world.clients.slice(1)] };
  await assert.rejects(() => assertNoCollisions(pools, w2), SeedCollisionError);
});

test("Tier A never issues UPDATE/DELETE (static check of the writer module)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../lib/tierA.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/\bUPDATE\b\s+\w|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\b/i.test(src.replace(/ON CONFLICT[^`]*DO NOTHING/g, "")));
  assert.equal(authUserRows(world, "h").length, world.clients.length + world.pts.length);
  assert.equal(profileRows(world).length, world.clients.length + world.pts.length);
});

// ---- the integrity script must actually detect corruption: inject, expect FAIL, clean up -------------------------------
async function withGymFixture(sqlInsert, sqlCleanup, fn) {
  const c = await pools.gym.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL gymini.compat_writer = 'seed'");
    for (const q of sqlInsert) await c.query(q);
    await c.query("COMMIT");
    await fn();
  } finally {
    await c.query("BEGIN").catch(() => {});
    await c.query("SET LOCAL gymini.compat_writer = 'seed'").catch(() => {});
    for (const q of sqlCleanup) await c.query(q).catch(() => {});
    await c.query("COMMIT").catch(() => {});
    c.release();
  }
}
const check = async (name) => (await runIntegrity(pools, { only: [name] }))[0];

test("integrity detects: role/is_pt mismatch", opts, async () => {
  const pt = world.pts[3];
  await pools.user.query(`UPDATE user_profiles SET "isPT" = true WHERE "userId" = $1`, [pt.userId]);
  try {
    const r = await check("auth role <-> user_profiles.is_pt");
    assert.equal(r.status, "FAIL");
    assert.ok(r.violations.some((v) => v.userId === pt.userId));
  } finally {
    await pools.user.query(`UPDATE user_profiles SET "isPT" = false WHERE "userId" = $1`, [pt.userId]);
  }
  assert.equal((await check("auth role <-> user_profiles.is_pt")).status, "PASS");
});

test("integrity detects: facilities mirror drift, >20 / no-cover PUBLISHED photos, brand of another owner", opts, async () => {
  const gid = "it-gym-1";
  const photoInserts = Array.from({ length: 21 }, (_, i) => `INSERT INTO gym_photos (id, gym_id, file_name, status, sort_order, is_cover) VALUES ('it-photo-${i}', '${gid}', 'x.webp', 'PUBLISHED', ${i}, false)`);
  await withGymFixture(
    [
      `INSERT INTO gym_brands (id, owner_id, name, updated_at) VALUES ('it-brand-1', 'it-owner-1', 'IT Brand', now())`,
      `INSERT INTO gyms (id, owner_id, brand_id, name, address, status, facilities, updated_at) VALUES ('${gid}', 'it-owner-OTHER', 'it-brand-1', 'IT Gym', 'x', 'APPROVED', ARRAY['WIFI']::"GymFacility"[], now())`,
      ...photoInserts,
    ],
    [`DELETE FROM legacy_compat_events WHERE entity_id = '${gid}'`, `DELETE FROM gym_photos WHERE gym_id = '${gid}'`, `DELETE FROM gyms WHERE id = '${gid}'`, `DELETE FROM gym_brands WHERE id = 'it-brand-1'`],
    async () => {
      const mirror = await check("gym_amenities (SYSTEM, ACTIVE) <-> gyms.facilities mirror");
      assert.equal(mirror.status, "FAIL");
      const photos = await check("PUBLISHED gym photos: <=20 per branch, exactly one cover");
      assert.equal(photos.status, "FAIL");
      assert.ok(photos.violations.some((v) => v.why === ">20 PUBLISHED photos") && photos.violations.some((v) => /cover count/.test(v.why)));
      const brand = await check("one Brand per Gym Owner (and per partner)");
      assert.equal(brand.status, "FAIL");
      assert.ok(brand.violations.some((v) => /branch owner differs/.test(v.why)));
    },
  );
  for (const n of ["gym_amenities (SYSTEM, ACTIVE) <-> gyms.facilities mirror", "PUBLISHED gym photos: <=20 per branch, exactly one cover", "one Brand per Gym Owner (and per partner)"]) {
    assert.notEqual((await check(n)).status, "FAIL", `${n} clean again after cleanup`);
  }
});

test("integrity detects: a WRITER_ABSENT compat event on a seed gym (and the seed writer variant is NON_CLIENT)", opts, async () => {
  const gid = "it-gym-2";
  const cleanup = [`DELETE FROM legacy_compat_events WHERE entity_id = '${gid}'`, `DELETE FROM gyms WHERE id = '${gid}'`];
  const c = await pools.gym.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO gyms (id, owner_id, name, address, status, email, updated_at) VALUES ('${gid}', 'it-owner-2', 'IT Gym 2', 'x', 'DRAFT', 'it-gym-2@seed.gymini.test', now())`); // no compat writer set -> trigger logs WRITER_ABSENT
    await c.query("COMMIT");
    const r = await check("no WRITER_ABSENT compat event from the seed");
    assert.equal(r.status, "FAIL");
    for (const q of cleanup) await pools.gym.query(q);
    // with the documented marker the trigger classifies the write as NON_CLIENT
    await c.query("BEGIN");
    await c.query("SET LOCAL gymini.compat_writer = 'seed'");
    await c.query(`INSERT INTO gyms (id, owner_id, name, address, status, email, updated_at) VALUES ('${gid}', 'it-owner-2', 'IT Gym 2', 'x', 'DRAFT', 'it-gym-2@seed.gymini.test', now())`);
    await c.query("COMMIT");
    assert.notEqual((await check("no WRITER_ABSENT compat event from the seed")).status, "FAIL");
  } finally {
    for (const q of cleanup) await pools.gym.query(q).catch(() => {});
    c.release();
  }
});
