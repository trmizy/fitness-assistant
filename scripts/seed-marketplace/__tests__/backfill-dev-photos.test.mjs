// BACKEND INTEGRATION on the isolated test container (localhost:55433, gymcoach_{user,gym}_seed_test) + TEST FIXTURE rows (ids prefixed bf-).
// Skipped unless SEED_MARKETPLACE_RUN_DB_TESTS=true. Uses an in-memory object store: no MinIO / dev DB is ever touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import {
  PROTECTED_EMAILS,
  applyPlan,
  backfillId,
  buildPlan,
  coverageCounts,
  makeMemoryStorage,
  makePools,
  makeTempAvatarSink,
  resolveBackfillTarget,
} from "../backfill-dev-photos.mjs";
import { loadUsableMasterPools } from "../lib/scale/media.mjs";

test("resolveBackfillTarget refuses anything but dev:5433 (+confirm) or test:55433", () => {
  assert.throws(() => resolveBackfillTarget({ target: "dev" }), /--confirm dev/);
  assert.throws(() => resolveBackfillTarget({ target: "dev", confirm: "dev", env: { SEED_PG_PORT: "55440" } }), /localhost:5433/);
  assert.throws(() => resolveBackfillTarget({ target: "dev", confirm: "dev", env: { SEED_PG_HOST: "db.example.com" } }), /localhost:5433/);
  assert.throws(() => resolveBackfillTarget({ target: "scale", confirm: "dev" }), /--target/);
  assert.throws(() => resolveBackfillTarget({ target: "test", env: { SEED_PG_PORT: "5433" } }), /55433/);
  assert.throws(() => resolveBackfillTarget({ target: "test", suffix: "dev", env: {} }), /seed_test/);
  const dev = resolveBackfillTarget({ target: "dev", confirm: "dev", env: {} });
  assert.deepEqual([dev.port, dev.userDb, dev.gymDb], [5433, "gymcoach_user", "gymcoach_gym"]);
  const t = resolveBackfillTarget({ target: "test", env: {} });
  assert.deepEqual([t.port, t.userDb, t.gymDb], [55433, "gymcoach_user_seed_test", "gymcoach_gym_seed_test"]);
});

test("backfillId is deterministic and uuid-shaped", () => {
  assert.equal(backfillId("pt-photo", "u1", 0), backfillId("pt-photo", "u1", 0));
  assert.notEqual(backfillId("pt-photo", "u1", 0), backfillId("pt-photo", "u1", 1));
  assert.match(backfillId("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

const enabled = process.env.SEED_MARKETPLACE_RUN_DB_TESTS === "true";
// Own throw-away DB pair (cloned from the scale templates) so this file never races db.test.mjs / scale-integration.test.mjs,
// which run in parallel against gymcoach_*_seed_test / gymcoach_*_scale_seed_test.
const SUFFIX = "bf_seed_test";
const target = resolveBackfillTarget({ target: "test", suffix: SUFFIX, env: {} });
const admin = () => new pg.Client({ host: target.host, port: target.port, user: target.user, password: target.password, database: "postgres" });
async function cloneDbs(drop) {
  const c = admin();
  await c.connect();
  try {
    for (const [svc, db] of [["user", target.userDb], ["gym", target.gymDb]]) {
      await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      if (!drop) await c.query(`CREATE DATABASE "${db}" TEMPLATE "gymcoach_${svc}_scale_tpl_test"`);
    }
  } finally {
    await c.end();
  }
}
let reachable = enabled;
if (enabled) {
  try {
    await cloneDbs(false);
  } catch {
    reachable = false;
  }
}
const pools = makePools(target);
const opts = { skip: reachable ? false : "needs SEED_MARKETPLACE_RUN_DB_TESTS=true and the 55433 scale_tpl_test templates" };

const PT = (n) => `bf-pt-${n}`;
const GYM = (n) => `bf-gym-${n}`;

async function cleanup() {
  await pools.user.query(`DELETE FROM pt_restrictions WHERE pt_user_id LIKE 'bf-pt-%'`);
  await pools.user.query(`DELETE FROM pt_physique_photos WHERE pt_user_id LIKE 'bf-pt-%'`);
  await pools.user.query(`DELETE FROM pt_applications WHERE user_profile_id LIKE 'bf-pt-%'`);
  await pools.user.query(`DELETE FROM user_profiles WHERE "userId" LIKE 'bf-pt-%'`);
  await pools.gym.query(`DELETE FROM gym_photos WHERE gym_id LIKE 'bf-gym-%'`);
  const c = await pools.gym.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL gymini.compat_writer = 'seed'");
    await c.query(`DELETE FROM gyms WHERE id LIKE 'bf-gym-%'`);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

async function addPt(n, { gender, email, specialties = [], app = "APPROVED", suspended = false, photoUrl = null }) {
  await pools.user.query(
    `INSERT INTO user_profiles (id, "userId", email, gender, "isPT", pt_suspended, photo_url, "updatedAt")
     VALUES ($1, $1, $2, $3::"Gender", true, $4, $5, now())`,
    [PT(n), email, gender, suspended, photoUrl]
  );
  await pools.user.query(
    `INSERT INTO pt_applications (id, user_profile_id, status, main_specialties, updated_at) VALUES ($1, $2, $3::"PTApplicationStatus", $4::text[], now())`,
    [`bf-app-${n}`, PT(n), app, specialties]
  );
}

async function addGym(n, { status = "APPROVED", facilities = [], email = null }) {
  const c = await pools.gym.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL gymini.compat_writer = 'seed'");
    await c.query(
      `INSERT INTO gyms (id, owner_id, name, address, status, facilities, email, updated_at)
       VALUES ($1, $2, $3, 'addr', $4::"GymStatus", $5::"GymFacility"[], $6, now())`,
      [GYM(n), `bf-owner-${n}`, `BF Gym ${n}`, status, facilities, email]
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

async function fixture() {
  await cleanup();
  const masters = loadUsableMasterPools();
  // PTs
  await addPt(1, { gender: "MALE", email: "bf-one@seed.gymini.test", specialties: ["Boxing & MMA"] }); // needs photos + avatar
  await addPt(2, { gender: "FEMALE", email: "bf-two@seed.gymini.test", specialties: ["Yoga"] }); // needs photos + avatar
  await addPt(3, { gender: "FEMALE", email: "bf-three@seed.gymini.test", photoUrl: "/uploads/profile-photos/real.webp" }); // has a real photo below -> untouched, own avatar kept
  await pools.user.query(
    `INSERT INTO pt_physique_photos (id, pt_user_id, storage_key, status, sort_order, is_cover, mime, bytes, content_hash, uploaded_by)
     VALUES ('bf-real-1', $1, 'pt-physique/bf-pt-3/real.webp', 'PUBLISHED', 0, true, 'image/webp', 10, 'realhash', $1)`,
    [PT(3)]
  );
  await addPt(4, { gender: "MALE", email: "bf-four@seed.gymini.test" }); // has only STAGED photo whose hash equals a master -> must not collide
  const stagedMaster = masters.ptMale[0];
  await pools.user.query(
    `INSERT INTO pt_physique_photos (id, pt_user_id, storage_key, status, sort_order, is_cover, mime, bytes, content_hash, uploaded_by)
     VALUES ('bf-staged-1', $1, 'pt-physique/bf-pt-4/staged.webp', 'STAGED', 0, false, 'image/webp', 10, $2, $1)`,
    [PT(4), stagedMaster.sha256]
  );
  await addPt(5, { gender: null, email: "bf-five@seed.gymini.test" }); // no gender -> skipped
  await addPt(6, { gender: "MALE", email: "real.person@example.com" }); // not seed domain -> skipped
  await addPt(7, { gender: "MALE", email: PROTECTED_EMAILS[0] }); // protected -> skipped
  await addPt(8, { gender: "MALE", email: "bf-eight@seed.gymini.test", suspended: true }); // not public
  await addPt(9, { gender: "MALE", email: "bf-nine@seed.gymini.test", app: "SUBMITTED" }); // not public
  await addPt(10, { gender: "FEMALE", email: "bf-ten@seed.gymini.test" }); // ACCOUNT restriction -> not public
  await pools.user.query(
    `INSERT INTO pt_restrictions (id, pt_user_id, type, imposed_by, updated_at) VALUES ('bf-restr-1', $1, 'TEMPORARY_SUSPENSION', 'admin', now())`,
    [PT(10)]
  );
  // gyms
  await addGym(1, { facilities: ["SWIMMING_POOL", "FREE_WEIGHTS"], email: "bf-g1@seed.gymini.test" }); // needs cover
  await addGym(2, { facilities: ["YOGA_STUDIO"], email: "bf-g2@seed.gymini.test" }); // needs cover
  await addGym(3, { facilities: [], email: "bf-g3@seed.gymini.test" }); // has a PUBLISHED cover -> untouched
  await pools.gym.query(
    `INSERT INTO gym_photos (id, gym_id, file_name, sort_order, is_cover, s3_key, category, visibility, status, content_hash)
     VALUES ('bf-gp-1', $1, 'real.webp', 0, true, 'listing-photos/bf-gym-3/real.webp', 'OTHER', 'PRIVATE', 'PUBLISHED', 'gymrealhash')`,
    [GYM(3)]
  );
  await addGym(4, { facilities: ["FUNCTIONAL_TRAINING_AREA"], email: "bf-g4@seed.gymini.test" }); // only STAGED photos -> still needs a cover
  await pools.gym.query(
    `INSERT INTO gym_photos (id, gym_id, file_name, sort_order, is_cover, s3_key, category, visibility, status, content_hash)
     VALUES ('bf-gp-2', $1, 's.webp', 0, false, 'listing-photos/bf-gym-4/s.webp', 'OTHER', 'PRIVATE', 'STAGED', 'staged-hash')`,
    [GYM(4)]
  );
  await addGym(5, { status: "PENDING_REVIEW", facilities: [], email: "bf-g5@seed.gymini.test" }); // not public
}

async function fixtureCounts() {
  const ptRows = (await pools.user.query(`SELECT pt_user_id, status::text, sort_order, is_cover, content_hash, storage_key FROM pt_physique_photos WHERE pt_user_id LIKE 'bf-pt-%' ORDER BY id`)).rows;
  const gymRows = (await pools.gym.query(`SELECT gym_id, status::text, sort_order, is_cover, content_hash, s3_key, visibility::text, category::text FROM gym_photos WHERE gym_id LIKE 'bf-gym-%' ORDER BY id`)).rows;
  const avatars = (await pools.user.query(`SELECT "userId" AS uid, photo_url FROM user_profiles WHERE "userId" LIKE 'bf-pt-%' ORDER BY 1`)).rows;
  return { ptRows, gymRows, avatars };
}

test("backfill: fills only the gaps, is idempotent (2nd run adds 0), never touches protected/real/non-public entities", opts, async () => {
  await fixture();
  const masters = loadUsableMasterPools();
  const maleHashes = new Set(masters.ptMale.map((m) => m.sha256));
  const femaleHashes = new Set(masters.ptFemale.map((m) => m.sha256));
  const run = async () => {
    const plan = await buildPlan({ pools, masterPools: masters });
    const storage = makeMemoryStorage();
    const sink = makeTempAvatarSink();
    const added = await applyPlan({ pools, plan, storage, avatarSink: sink });
    const files = fs.readdirSync(sink.dir);
    fs.rmSync(sink.dir, { recursive: true, force: true });
    return { plan, added, storage, files };
  };

  const before = await fixtureCounts();
  const r1 = await run();
  // PT 1, 2, 4 get photos (3 has a real one, 5/6/7 skipped, 8/9/10 not public); gyms 1, 2, 4 get covers
  assert.deepEqual(r1.plan.ptPhotos.map((p) => p.uid).filter((u) => u.startsWith("bf-pt-")).sort(), [PT(1), PT(2), PT(4)]);
  assert.deepEqual(r1.plan.gymPhotos.map((g) => g.gymId).filter((u) => u.startsWith("bf-gym-")).sort(), [GYM(1), GYM(2), GYM(4)]);
  const after1 = await fixtureCounts();

  // PT photos: 1..3 each, PUBLISHED, exactly one cover, gender-matched, bucket key shape, no duplicate hash per PT, staged hash not re-used
  for (const uid of [PT(1), PT(2), PT(4)]) {
    const rows = after1.ptRows.filter((r) => r.pt_user_id === uid && r.status === "PUBLISHED");
    assert.ok(rows.length >= 1 && rows.length <= 3, `${uid} photo count ${rows.length}`);
    assert.equal(rows.filter((r) => r.is_cover).length, 1);
    assert.equal(rows.find((r) => r.is_cover).sort_order, 0);
    assert.equal(new Set(rows.map((r) => r.content_hash)).size, rows.length);
    for (const r of rows) assert.match(r.storage_key, new RegExp(`^pt-physique/${uid}/[0-9a-f-]{36}\\.webp$`));
    const pool = uid === PT(2) ? femaleHashes : maleHashes;
    for (const r of rows) assert.ok(pool.has(r.content_hash), `${uid} photo hash not from the gender-matched pool`);
  }
  const pt4Pub = after1.ptRows.filter((r) => r.pt_user_id === PT(4) && r.status === "PUBLISHED");
  assert.ok(!pt4Pub.some((r) => r.content_hash === masters.ptMale[0].sha256), "collided with the STAGED hash");
  // untouched
  for (const uid of [PT(3), PT(5), PT(6), PT(7), PT(8), PT(9), PT(10)]) {
    assert.deepEqual(after1.ptRows.filter((r) => r.pt_user_id === uid), before.ptRows.filter((r) => r.pt_user_id === uid), `${uid} changed`);
  }
  // avatars: PT 1,2,4 (seed domain, public, null) get one; PT3 keeps its own; protected/non-seed/non-public stay null
  const av = Object.fromEntries(after1.avatars.map((a) => [a.uid, a.photo_url]));
  for (const uid of [PT(1), PT(2), PT(4)]) assert.equal(av[uid], `/uploads/profile-photos/${uid}.webp`);
  assert.equal(av[PT(3)], "/uploads/profile-photos/real.webp");
  // PT 5 is a public seed PT without gender: no photo (cannot be gender-matched) but a gender-neutral avatar is fine
  assert.equal(av[PT(5)], `/uploads/profile-photos/${PT(5)}.webp`);
  for (const uid of [PT(6), PT(7), PT(8), PT(9), PT(10)]) assert.equal(av[uid], null, `${uid} avatar must stay null`);
  assert.ok(r1.files.includes(`${PT(1)}.webp`));

  // gyms: 3..5 PUBLISHED, one cover, PRIVATE like the real upload path, listing-photos/<gymId>/<uuid>.webp
  for (const id of [GYM(1), GYM(2), GYM(4)]) {
    const rows = after1.gymRows.filter((r) => r.gym_id === id && r.status === "PUBLISHED");
    assert.ok(rows.length >= 3 && rows.length <= 5, `${id} photo count ${rows.length}`);
    assert.equal(rows.filter((r) => r.is_cover).length, 1);
    assert.equal(new Set(rows.map((r) => r.content_hash)).size, rows.length);
    for (const r of rows) {
      assert.equal(r.visibility, "PRIVATE");
      assert.match(r.s3_key, new RegExp(`^listing-photos/${id}/[0-9a-f-]{36}\\.webp$`));
    }
  }
  const g1cats = after1.gymRows.filter((r) => r.gym_id === GYM(1)).map((r) => r.category);
  assert.ok(g1cats.includes("AMENITIES"), "pool gym should get a pool (AMENITIES) photo");
  assert.deepEqual(after1.gymRows.filter((r) => r.gym_id === GYM(3)), before.gymRows.filter((r) => r.gym_id === GYM(3)));
  assert.deepEqual(after1.gymRows.filter((r) => r.gym_id === GYM(5)), before.gymRows.filter((r) => r.gym_id === GYM(5)));
  assert.equal(after1.gymRows.filter((r) => r.gym_id === GYM(4) && r.status === "STAGED").length, 1, "STAGED row must stay");

  // objects uploaded match rows
  assert.equal(r1.storage.objects.size, r1.added.ptPhotoRows + r1.added.gymPhotoRows);

  // 2nd run: nothing to add
  const r2 = await run();
  const fixturePlanned2 = [...r2.plan.ptPhotos.map((p) => p.uid).filter((u) => u.startsWith("bf-")), ...r2.plan.gymPhotos.map((g) => g.gymId).filter((u) => u.startsWith("bf-")), ...r2.plan.avatars.map((a) => a.uid).filter((u) => u.startsWith("bf-"))];
  assert.deepEqual(fixturePlanned2, [], "fixture entities planned again on the 2nd run");
  assert.deepEqual(
    [r2.added.ptPhotoRows, r2.added.gymPhotoRows, r2.added.avatars, r2.added.ptsPhotographed, r2.added.gymsPhotographed],
    [0, 0, 0, 0, 0]
  );
  assert.equal(r2.storage.objects.size, 0);
  const after2 = await fixtureCounts();
  assert.deepEqual(after2, after1, "2nd run changed the fixture rows");

  const cov = await coverageCounts(pools);
  assert.ok(cov.pt.public_pts >= 5 && cov.gym.public_gyms >= 4);
  await cleanup();
});

test.after(async () => {
  await pools.user.end();
  await pools.gym.end();
  if (reachable) await cloneDbs(true).catch(() => {});
});
