// REAL avatars for the official target (lib/real-avatars.mjs + `backfill-dev-photos.mjs --target official` + scale integrity check 8/7 extension).
//   - guard tests: pure, no DB, no network (TEST FIXTURE).
//   - DB tests: BACKEND INTEGRATION on the isolated test container (localhost:55433), own throw-away pair gymcoach_{user,gym}_ra_seed_test cloned from
//     the *_scale_tpl_test templates; fixture rows are prefixed ra-. Skipped unless SEED_MARKETPLACE_RUN_DB_TESTS=true. Never touches the dev DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SeedGuardError } from "../lib/guard.mjs";
import { applyRealAvatars, planRealAvatars, realAvatarCounts, REAL_AVATAR_PROTECTED_EMAILS } from "../lib/real-avatars.mjs";
import { generateAvatarBuffer } from "../generate-avatars.mjs";
import { resolveBackfillTarget } from "../backfill-dev-photos.mjs";
import { runScaleIntegrity } from "../lib/scale/integrity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OK = { SEED_MARKETPLACE_CONFIRM: "official" };
const refuses = (fn, code) => assert.throws(fn, (e) => e instanceof SeedGuardError && e.code === code, `expected ${code}`);

// ------------------------------------------------------------------------------------------------------------------ guard

test("official backfill target: needs SEED_MARKETPLACE_CONFIRM=official, loopback, no production; resolves the _official user/gym DBs", () => {
  const t = resolveBackfillTarget({ target: "official", env: { ...OK } });
  assert.deepEqual([t.kind, t.host, t.port, t.userDb, t.gymDb], ["official", "localhost", 5433, "gymcoach_user_official", "gymcoach_gym_official"]);
  refuses(() => resolveBackfillTarget({ target: "official", env: {} }), "CONFIRM_MISSING");
  for (const wrong of ["dev", "scale", "partner", "OFFICIAL", "true"]) refuses(() => resolveBackfillTarget({ target: "official", env: { SEED_MARKETPLACE_CONFIRM: wrong } }), "CONFIRM_MISSING");
  refuses(() => resolveBackfillTarget({ target: "official", env: { ...OK, NODE_ENV: "production" } }), "PRODUCTION_REFUSED");
  refuses(() => resolveBackfillTarget({ target: "official", env: { ...OK, SEED_PG_HOST: "db.example.com" } }), "HOST_NOT_ALLOWED");
  refuses(() => resolveBackfillTarget({ target: "official", env: { ...OK, SEED_PG_HOST: "prod-db.internal" } }), "FORBIDDEN_DB_NAME");
  refuses(() => resolveBackfillTarget({ target: "official", env: { ...OK, SEED_PG_HOST: "localhost", SEED_PG_PORT: "55440" } }), "HOST_NOT_ALLOWED"); // the reserved scale endpoint
  assert.equal(resolveBackfillTarget({ target: "official", env: { ...OK, SEED_PG_HOST: "db.example.com" }, allowRemoteHost: true }).host, "db.example.com");
  for (const host of ["127.0.0.1", "::1"]) assert.equal(resolveBackfillTarget({ target: "official", env: { ...OK, SEED_PG_HOST: host } }).host, host);
});

test("the existing dev/test targets keep their own rules (official mode did not loosen them)", () => {
  assert.throws(() => resolveBackfillTarget({ target: "dev" }), /--confirm dev/);
  assert.throws(() => resolveBackfillTarget({ target: "scale", confirm: "scale" }), /--target/);
  assert.equal(resolveBackfillTarget({ target: "test", env: {} }).port, 55433);
});

test("CLI: `--target official` without SEED_MARKETPLACE_CONFIRM exits 1 before any connection and says why", () => {
  const env = { ...process.env, SEED_PG_HOST: "127.0.0.1", SEED_PG_PORT: "1" }; // unreachable on purpose: a refusal must come first
  delete env.SEED_MARKETPLACE_CONFIRM;
  const r = spawnSync(process.execPath, [path.resolve(here, "..", "backfill-dev-photos.mjs"), "--target", "official", "--dry-run"], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SEED_MARKETPLACE_CONFIRM=official/);
  assert.doesNotMatch(r.stderr + r.stdout, /ECONNREFUSED/);
});

test("PROTECTED e-mail list contains huytronh4@gmail.com", () => {
  assert.ok(REAL_AVATAR_PROTECTED_EMAILS.includes("huytronh4@gmail.com"));
});

// ------------------------------------------------------------------------------------------------------------------ DB

const enabled = process.env.SEED_MARKETPLACE_RUN_DB_TESTS === "true";
const SUFFIX = "ra_seed_test";
const cfg = { host: "localhost", port: 55433, user: "gymcoach_test", password: "gymcoach_test_password" };
const DBS = { user: `gymcoach_user_${SUFFIX}`, gym: `gymcoach_gym_${SUFFIX}` };
async function cloneDbs(drop) {
  const c = new pg.Client({ ...cfg, database: "postgres" });
  await c.connect();
  try {
    for (const svc of ["user", "gym"]) {
      await c.query(`DROP DATABASE IF EXISTS "${DBS[svc]}" WITH (FORCE)`);
      if (!drop) await c.query(`CREATE DATABASE "${DBS[svc]}" TEMPLATE "gymcoach_${svc}_scale_tpl_test"`);
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
const pools = reachable ? { user: new pg.Pool({ ...cfg, database: DBS.user, max: 4 }), gym: new pg.Pool({ ...cfg, database: DBS.gym, max: 4 }) } : null;
const opts = { skip: reachable ? false : "needs SEED_MARKETPLACE_RUN_DB_TESTS=true and the 55433 scale_tpl_test templates" };

const U = (n) => `ra-u-${n}`;
async function cleanup() {
  await pools.user.query(`DELETE FROM pt_applications WHERE user_profile_id LIKE 'ra-u-%'`);
  await pools.user.query(`DELETE FROM user_profiles WHERE "userId" LIKE 'ra-u-%'`);
}
async function addProfile(n, { email, isPT = false, photoUrl = null, app = null }) {
  await pools.user.query(
    `INSERT INTO user_profiles (id, "userId", email, "isPT", photo_url, "updatedAt") VALUES ($1, $1, $2, $3, $4, now())`,
    [U(n), email, isPT, photoUrl]
  );
  if (app) {
    await pools.user.query(
      `INSERT INTO pt_applications (id, user_profile_id, status, main_specialties, updated_at) VALUES ($1, $2, $3::"PTApplicationStatus", ARRAY[]::text[], now())`,
      [`ra-app-${n}`, U(n), app]
    );
  }
}
async function fixture() {
  await cleanup();
  await addProfile(1, { email: "ra-pt-one@seed.gymini.test", isPT: true, app: "APPROVED" }); // REAL public PT, NULL -> gets an avatar
  await addProfile(2, { email: "ra-client@seed.gymini.test" }); // REAL client, NULL -> gets an avatar
  await addProfile(3, { email: "RA-Mixed-Case@Seed.Gymini.Test", isPT: true, app: "APPROVED" }); // e-mail case does not matter
  await addProfile(4, { email: "ra-uploaded@seed.gymini.test", isPT: true, app: "APPROVED", photoUrl: "/uploads/profile-photos/real-user-upload.webp" }); // user's own photo: untouched
  await addProfile(5, { email: "ra-scale@scale.gymini.test", isPT: true, app: "APPROVED" }); // SYNTHETIC: never touched
  await addProfile(6, { email: "real.person@example.com", isPT: true, app: "APPROVED" }); // foreign account: never touched
  await addProfile(7, { email: REAL_AVATAR_PROTECTED_EMAILS[0], isPT: true, app: "APPROVED" }); // protected: never touched
  await addProfile(8, { email: null }); // no e-mail: never touched
  await addProfile(9, { email: "ra-empty@seed.gymini.test", photoUrl: "" }); // '' is not NULL: the guard only fills NULL
}
const snap = async () => (await pools.user.query(`SELECT "userId" AS uid, photo_url FROM user_profiles WHERE "userId" LIKE 'ra-u-%' ORDER BY 1`)).rows;
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ra-avatars-"));

test("real avatars: fills only REAL seed profiles with NULL photo_url, writes the scale-identical file, never touches anything else", opts, async () => {
  await fixture();
  const dir = tmpDir();
  try {
    const plan = await planRealAvatars(pools.user);
    const mine = plan.filter((a) => a.uid.startsWith("ra-u-"));
    assert.deepEqual(mine.map((a) => a.uid), [U(1), U(2), U(3)]);
    assert.deepEqual(mine.map((a) => a.isPt), [true, false, true]);
    const before = await snap();
    const r1 = await applyRealAvatars({ userPool: pools.user, plan, avatarsDir: dir });
    assert.equal(r1.rowsUpdated, plan.length);
    const after = Object.fromEntries((await snap()).map((x) => [x.uid, x.photo_url]));
    for (const n of [1, 2, 3]) assert.equal(after[U(n)], `/uploads/profile-photos/${U(n)}.webp`);
    // untouched
    for (const n of [4, 5, 6, 7, 8, 9]) assert.equal(after[U(n)], before.find((b) => b.uid === U(n)).photo_url, `${U(n)} changed`);
    assert.equal(after[U(4)], "/uploads/profile-photos/real-user-upload.webp");
    assert.equal(after[U(9)], "");
    // files: exactly the planned ones, named <userId>.webp, byte-identical to what the scale tier would generate for that id, valid 256x256 WebP
    assert.ok(fs.existsSync(path.join(dir, `${U(1)}.webp`)));
    assert.ok(!fs.existsSync(path.join(dir, `${U(4)}.webp`)) && !fs.existsSync(path.join(dir, `${U(5)}.webp`)));
    const buf = fs.readFileSync(path.join(dir, `${U(1)}.webp`));
    assert.ok(buf.equals(await generateAvatarBuffer(U(1), { size: 256 })), "avatar differs from the scale-tier generator output");
    assert.equal(buf.subarray(0, 4).toString("latin1"), "RIFF");
    assert.equal(buf.subarray(8, 12).toString("latin1"), "WEBP");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  }
});

test("real avatars: idempotent - a 2nd run plans nothing, writes nothing, changes no row", opts, async () => {
  await fixture();
  const dir = tmpDir();
  try {
    await applyRealAvatars({ userPool: pools.user, plan: await planRealAvatars(pools.user), avatarsDir: dir });
    const rowsAfter1 = await snap();
    const filesAfter1 = fs.readdirSync(dir).sort();
    const stamp = fs.statSync(path.join(dir, filesAfter1[0])).mtimeMs;
    const plan2 = await planRealAvatars(pools.user);
    assert.deepEqual(plan2.filter((a) => a.uid.startsWith("ra-u-")), []);
    const r2 = await applyRealAvatars({ userPool: pools.user, plan: plan2, avatarsDir: dir });
    assert.deepEqual([r2.planned, r2.rowsUpdated, r2.filesWritten, r2.raced], [0, 0, 0, 0]);
    assert.deepEqual(await snap(), rowsAfter1);
    assert.deepEqual(fs.readdirSync(dir).sort(), filesAfter1);
    assert.equal(fs.statSync(path.join(dir, filesAfter1[0])).mtimeMs, stamp);
    // a file that already exists (e.g. avatars dir restored from an earlier run) is kept, not regenerated
    await pools.user.query(`UPDATE user_profiles SET photo_url = NULL WHERE "userId" = $1`, [U(2)]);
    const r3 = await applyRealAvatars({ userPool: pools.user, plan: (await planRealAvatars(pools.user)).filter((a) => a.uid === U(2)), avatarsDir: dir });
    assert.deepEqual([r3.rowsUpdated, r3.filesKept, r3.filesWritten], [1, 1, 0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  }
});

test("real avatars: a photo uploaded between plan and apply is never overwritten (and no orphan file is left)", opts, async () => {
  await fixture();
  const dir = tmpDir();
  try {
    const plan = (await planRealAvatars(pools.user)).filter((a) => a.uid.startsWith("ra-u-"));
    await pools.user.query(`UPDATE user_profiles SET photo_url = '/uploads/profile-photos/just-uploaded.webp' WHERE "userId" = $1`, [U(2)]);
    const r = await applyRealAvatars({ userPool: pools.user, plan, avatarsDir: dir });
    assert.equal(r.raced, 1);
    assert.equal(r.rowsUpdated, 2);
    const rows = Object.fromEntries((await snap()).map((x) => [x.uid, x.photo_url]));
    assert.equal(rows[U(2)], "/uploads/profile-photos/just-uploaded.webp");
    assert.ok(!fs.existsSync(path.join(dir, `${U(2)}.webp`)), "orphan avatar file left behind");
    assert.ok(fs.existsSync(path.join(dir, `${U(1)}.webp`)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  }
});

test("real avatars: realAvatarCounts reports REAL public PT coverage; scale integrity check 8 FAILS a REAL public PT without avatar, passes after", opts, async () => {
  await fixture();
  const dir = tmpDir();
  const check8 = async () => {
    const res = await runScaleIntegrity({ pools: { ...pools, auth: pools.user, payment: pools.user }, scaleFactor: 0.01, checkMedia: false });
    return res.find((r) => r.name.startsWith("8."));
  };
  try {
    const c0 = await realAvatarCounts(pools.user);
    assert.ok(c0.public_pts >= 3 && c0.public_pts_with_avatar < c0.public_pts);
    const r0 = await check8();
    const bad0 = r0.violations.filter((v) => String(v.uid ?? "").startsWith("ra-u-") && /without avatar/.test(v.why));
    // (check 8, like every other seed check, matches the lower-case domain with a case-sensitive LIKE; seed e-mails are always lower-case, so the mixed-case fixture U(3) is out of its scope)
    assert.deepEqual(bad0.map((v) => v.uid).sort(), [U(1), U(5)], "REAL (and, as before, SYNTHETIC) public PTs without avatar must be flagged by check 8");
    // never flagged: the PT with an own photo, foreign accounts, the protected account
    assert.ok(!bad0.some((v) => [U(4), U(6), U(7)].includes(v.uid)));
    await applyRealAvatars({ userPool: pools.user, plan: await planRealAvatars(pools.user), avatarsDir: dir });
    const c1 = await realAvatarCounts(pools.user);
    assert.equal(c1.public_pts_with_avatar, c1.public_pts);
    const bad1 = (await check8()).violations.filter((v) => /without avatar/.test(v.why) && String(v.uid ?? "").startsWith("ra-u-") && v.uid !== U(5));
    assert.deepEqual(bad1, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  }
});

test.after(async () => {
  if (!pools) return;
  await pools.user.end();
  await pools.gym.end();
  await cloneDbs(true).catch(() => {});
});
