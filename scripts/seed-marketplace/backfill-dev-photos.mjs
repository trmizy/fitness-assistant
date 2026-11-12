// One-off, re-runnable, idempotent photo/avatar backfill for the DEV database (decision Ngài 12/11: "production-like coverage").
//
// It only fills GAPS and never changes an existing row or object:
//   (a) every PUBLIC PT (isPT, APPROVED application, not suspended, no open ACCOUNT restriction) that has NO PUBLISHED
//       pt_physique_photos row gets 1-3 PUBLISHED photos, gender-matched to the PT (user_profiles.gender) from the audited
//       masters in assets/ + manifest.json. Bucket `gymini-user-media`, key `pt-physique/<userId>/<photoId>.webp` (the real upload key shape).
//   (b) every public PT with user_profiles.photo_url IS NULL gets a CC0 DiceBear avatar served the way dev user-service
//       really serves profile photos: local file `uploads/profile-photos/<userId>.webp` + photo_url `/uploads/profile-photos/<userId>.webp`
//       (dev has no USER_UPLOAD_BUCKET, so an `s3://profile-photos/...` ref would not resolve there; the scale seed uses the same URL shape).
//   (c) every public gym (APPROVED + OPEN) that has NO PUBLISHED gym_photos row gets 3-5 PUBLISHED photos (first = cover),
//       category-matched to its facilities. Bucket `gymini-partner-private`, key `listing-photos/<gymId>/<photoId>.webp`,
//       visibility PRIVATE exactly like the real listing upload path (images are served through presigned GET).
//
// Skipped on purpose: huytronh4@gmail.com (data never touched), PTs without a MALE/FEMALE gender on the profile (a photo could not be
// gender-matched), PTs outside the @seed.gymini.test domain (real/E2E accounts: reported, not changed), PTs/gyms that already have a
// PUBLISHED photo (real user uploads are never touched), and any STAGED / RETIRED / DISCARDED row.
//
// Idempotent: eligibility is recomputed from the DB every run, photo ids/keys are deterministic, rows are INSERT ... ON CONFLICT DO NOTHING,
// and each entity is processed under a transaction-scoped advisory lock after re-checking that it still has no PUBLISHED photo.
//
// Usage (repo root):
//   node scripts/seed-marketplace/backfill-dev-photos.mjs --target dev --confirm dev [--dry-run] [--plan-out <file.json>]
//   node scripts/seed-marketplace/backfill-dev-photos.mjs --target test            # *_seed_test on 55433, in-memory object store (no MinIO touched)
// Never prints passwords or keys.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { generateAvatarBuffer } from "./generate-avatars.mjs";
import { GYM_PHOTO_CATEGORY_MAP, loadAwsS3Sdk, loadUsableMasterPools } from "./lib/scale/media.mjs";
import { rngFrom } from "./lib/util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(here, "assets");

export const SEED_EMAIL_DOMAIN = "@seed.gymini.test";
/** Accounts whose data this script must never touch (lower-case e-mails). */
export const PROTECTED_EMAILS = Object.freeze(["huytronh4@gmail.com"]);
export const PT_BUCKET = "gymini-user-media";
export const GYM_BUCKET = "gymini-partner-private";
export const AVATAR_URL_PREFIX = "/uploads/profile-photos/";
export const USER_UPLOADS_DIR_IN_CONTAINER = "/app/backend/services/user-service/uploads/profile-photos";

// ---------------------------------------------------------------------------------------------------------------- targets

/** Hard allow-list: the dev DB on 5433 or (explicit --target test) the dedicated *_seed_test DBs on 55433. */
export function resolveBackfillTarget({ target, confirm, suffix = "seed_test", env = process.env }) {
  const host = env.SEED_PG_HOST || "localhost";
  if (target === "dev") {
    if (confirm !== "dev") throw new Error("Refusing: --target dev requires --confirm dev");
    const port = Number(env.SEED_PG_PORT || 5433);
    if (host !== "localhost" || port !== 5433) throw new Error(`Refusing: dev DB must be localhost:5433, got ${host}:${port}`);
    return {
      kind: "dev",
      host,
      port,
      user: env.SEED_PG_USER || "gymcoach",
      password: env.SEED_PG_PASSWORD || "gymcoach_password",
      userDb: "gymcoach_user",
      gymDb: "gymcoach_gym",
    };
  }
  if (target === "test") {
    if (!/^[a-z0-9_]*seed_test$/.test(suffix)) throw new Error("Refusing: test DB suffix must end in seed_test");
    const port = Number(env.SEED_PG_PORT || 55433);
    if (host !== "localhost" || port !== 55433) throw new Error(`Refusing: test DB must be localhost:55433, got ${host}:${port}`);
    return {
      kind: "test",
      host,
      port,
      user: env.SEED_PG_USER || "gymcoach_test",
      password: env.SEED_PG_PASSWORD || "gymcoach_test_password",
      userDb: `gymcoach_user_${suffix}`,
      gymDb: `gymcoach_gym_${suffix}`,
    };
  }
  throw new Error("Refusing: --target must be `dev` (with --confirm dev) or `test`");
}

export function makePools(t) {
  const mk = (database) => new pg.Pool({ host: t.host, port: t.port, user: t.user, password: t.password, database, max: 4 });
  return { user: mk(t.userDb), gym: mk(t.gymDb) };
}

// ---------------------------------------------------------------------------------------------------------------- helpers

const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Deterministic uuid-shaped id (so a re-run reuses the same keys/ids). */
export function backfillId(...parts) {
  const h = sha256Hex(Buffer.from(["dev-photo-backfill-v1", ...parts].join("|"))).slice(0, 32).split("");
  h[12] = "5";
  h[16] = "89ab"[parseInt(h[16], 16) % 4];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function shuffled(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks masters preferring (1) not yet used in this run, (2) not already a hash of the entity; never repeats inside one entity. */
function pickMasters({ preferred = [], pool, count, rng, usedRun, takenHashes }) {
  const out = [];
  const chosen = new Set(takenHashes);
  const tryList = (list) => {
    for (const m of list) {
      if (out.length >= count) return;
      if (chosen.has(m.sha256) || usedRun.has(m.id)) continue;
      chosen.add(m.sha256);
      usedRun.add(m.id);
      out.push(m);
    }
  };
  tryList(shuffled(preferred, rng));
  tryList(shuffled(pool, rng));
  if (out.length < count) {
    // pool exhausted for "unused in this run": allow reuse across entities (never inside one entity)
    for (const m of shuffled(pool, rng)) {
      if (out.length >= count) break;
      if (chosen.has(m.sha256)) continue;
      chosen.add(m.sha256);
      out.push(m);
    }
  }
  return out;
}

const readMaster = (m) => fs.readFileSync(path.join(ASSETS_DIR, ...m.file.split("/")));

// ---------------------------------------------------------------------------------------------------------------- queries

const PUBLIC_PT_SQL = `
  SELECT p."userId" AS uid, p.email, p.gender::text AS gender, p.photo_url,
         COALESCE(a.main_specialties, ARRAY[]::text[]) AS specialties,
         EXISTS (SELECT 1 FROM pt_physique_photos ph WHERE ph.pt_user_id = p."userId" AND ph.status = 'PUBLISHED') AS has_photo
  FROM user_profiles p
  JOIN pt_applications a ON a.user_profile_id = p.id
  WHERE p."isPT" = true AND p.pt_suspended = false AND a.status = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT')
  ORDER BY p."userId"`;

const PUBLIC_GYM_SQL = `
  SELECT g.id, g.name, g.owner_id, g.email, g.facilities::text[] AS facilities,
         EXISTS (SELECT 1 FROM gym_photos ph WHERE ph.gym_id = g.id AND ph.status = 'PUBLISHED') AS has_photo,
         EXISTS (SELECT 1 FROM gym_photos ph WHERE ph.gym_id = g.id AND ph.status = 'PUBLISHED' AND ph.is_cover) AS has_cover
  FROM gyms g
  WHERE g.status = 'APPROVED' AND g.operational_status = 'OPEN'
  ORDER BY g.id`;

// ---------------------------------------------------------------------------------------------------------------- planning

/**
 * Pure planning step: reads the DB (SELECT only) and decides what to add. No writes, no object-store calls.
 * Returns the plan plus the skipped entities with their reason.
 */
export async function buildPlan({ pools, masterPools = loadUsableMasterPools() }) {
  const protectedSet = new Set(PROTECTED_EMAILS);
  const skipped = { pt: [], gym: [] };
  const plan = { ptPhotos: [], avatars: [], gymPhotos: [], skipped, counts: {} };

  const { rows: pts } = await pools.user.query(PUBLIC_PT_SQL);
  const { rows: gyms } = await pools.gym.query(PUBLIC_GYM_SQL);

  // Protected owners (resolved through user_profiles: gym owners are user ids)
  const { rows: protRows } = await pools.user.query(`SELECT "userId" AS uid FROM user_profiles WHERE lower(email) = ANY($1::text[])`, [PROTECTED_EMAILS]);
  const protectedUserIds = new Set(protRows.map((r) => r.uid));

  const usedRunMale = new Set();
  const usedRunFemale = new Set();

  for (const pt of pts) {
    const email = String(pt.email ?? "").toLowerCase();
    if (protectedSet.has(email) || protectedUserIds.has(pt.uid)) {
      skipped.pt.push({ uid: pt.uid, reason: "protected account" });
      continue;
    }
    if (!email.endsWith(SEED_EMAIL_DOMAIN)) {
      if (!pt.has_photo || !pt.photo_url) skipped.pt.push({ uid: pt.uid, email: pt.email, reason: "not a seed-domain account (real/E2E account left untouched)" });
      continue;
    }
    const needAvatar = !pt.photo_url;
    const needPhotos = !pt.has_photo;
    if (needAvatar) {
      plan.avatars.push({ uid: pt.uid, fileName: `${pt.uid}.webp`, photoUrl: `${AVATAR_URL_PREFIX}${pt.uid}.webp` });
    }
    if (!needPhotos) continue;
    if (pt.gender !== "MALE" && pt.gender !== "FEMALE") {
      skipped.pt.push({ uid: pt.uid, email: pt.email, reason: `gender=${pt.gender ?? "null"}: no gender-matched photo possible` });
      continue;
    }
    const rng = rngFrom(`pt-backfill:${pt.uid}`);
    const r = rng();
    const count = r < 0.4 ? 1 : r < 0.8 ? 2 : 3;
    const pool = pt.gender === "FEMALE" ? masterPools.ptFemale : masterPools.ptMale;
    const specialties = pt.specialties ?? [];
    const preferred = specialties.includes("Boxing & MMA")
      ? pool.filter((m) => (m.audit?.disciplines ?? []).some((d) => String(d).includes("BOXING")))
      : specialties.includes("Yoga")
        ? pool.filter((m) => (m.audit?.disciplines ?? []).some((d) => String(d).includes("YOGA")))
        : [];
    // existing STAGED hashes of this PT must not collide with the unique (pt_user_id, content_hash) index
    const { rows: h } = await pools.user.query(
      `SELECT content_hash FROM pt_physique_photos WHERE pt_user_id = $1 AND status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL`,
      [pt.uid]
    );
    const masters = pickMasters({
      preferred,
      pool,
      count,
      rng,
      usedRun: pt.gender === "FEMALE" ? usedRunFemale : usedRunMale,
      takenHashes: h.map((x) => x.content_hash),
    });
    if (masters.length === 0) {
      skipped.pt.push({ uid: pt.uid, reason: "no master available" });
      continue;
    }
    plan.ptPhotos.push({
      uid: pt.uid,
      gender: pt.gender,
      photos: masters.map((m, i) => {
        const photoId = backfillId("pt-photo", pt.uid, i);
        return { id: photoId, masterId: m.id, masterFile: m.file, storageKey: `pt-physique/${pt.uid}/${photoId}.webp`, sortOrder: i, isCover: i === 0 };
      }),
    });
  }

  const generalGymCats = ["gym-interior", "fitness-center", "free-weights", "cardio", "crossfit", "functional", "exterior", "locker-room", "reception"];
  const heroCats = ["gym-interior", "fitness-center", "free-weights", "functional", "exterior"];
  const flat = (cats) => cats.flatMap((c) => masterPools.gymByCategory.get(c) ?? []);
  const generalItems = flat(generalGymCats);
  const heroItems = flat(heroCats);
  const usedRunGym = new Set();

  for (const g of gyms) {
    const email = String(g.email ?? "").toLowerCase();
    if (protectedSet.has(email) || protectedUserIds.has(g.owner_id)) {
      skipped.gym.push({ id: g.id, reason: "protected account" });
      continue;
    }
    if (g.has_photo) {
      if (!g.has_cover) skipped.gym.push({ id: g.id, name: g.name, reason: "has PUBLISHED photos but no cover: left untouched (needs a manual decision)" });
      continue;
    }
    const rng = rngFrom(`gym-backfill:${g.id}`);
    const count = 3 + Math.floor(rng() * 3); // 3..5
    const fac = new Set(g.facilities ?? []);
    const { rows: h } = await pools.gym.query(
      `SELECT content_hash FROM gym_photos WHERE gym_id = $1 AND status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL`,
      [g.id]
    );
    const taken = new Set(h.map((x) => x.content_hash));
    const chosen = [];
    for (let i = 0; i < count; i++) {
      let preferred = i === 0 ? heroItems : [];
      if (i === 1 && fac.has("SWIMMING_POOL")) preferred = masterPools.gymByCategory.get("pool") ?? [];
      else if (i === 1 && fac.has("YOGA_STUDIO")) preferred = masterPools.gymByCategory.get("yoga-studio") ?? [];
      else if (i === 2 && fac.has("FUNCTIONAL_TRAINING_AREA")) preferred = masterPools.gymByCategory.get("boxing") ?? [];
      else if (i === 2 && fac.has("CARDIO_MACHINES")) preferred = masterPools.gymByCategory.get("cardio") ?? [];
      const [m] = pickMasters({ preferred, pool: generalItems, count: 1, rng, usedRun: usedRunGym, takenHashes: [...taken] });
      if (!m) break;
      taken.add(m.sha256);
      const effCat = m.audit?.reclassifiedCategory || m.category;
      const photoId = backfillId("gym-photo", g.id, i);
      chosen.push({
        id: photoId,
        masterId: m.id,
        masterFile: m.file,
        fileName: `${photoId}.webp`,
        s3Key: `listing-photos/${g.id}/${photoId}.webp`,
        sortOrder: i,
        isCover: i === 0,
        category: GYM_PHOTO_CATEGORY_MAP[effCat] || "OTHER",
      });
    }
    if (chosen.length === 0) {
      skipped.gym.push({ id: g.id, reason: "no master available" });
      continue;
    }
    plan.gymPhotos.push({ gymId: g.id, ownerId: g.owner_id, name: g.name, photos: chosen });
  }

  plan.counts = {
    publicPts: pts.length,
    publicGyms: gyms.length,
    ptsToPhoto: plan.ptPhotos.length,
    ptPhotoRows: plan.ptPhotos.reduce((n, p) => n + p.photos.length, 0),
    avatars: plan.avatars.length,
    gymsToPhoto: plan.gymPhotos.length,
    gymPhotoRows: plan.gymPhotos.reduce((n, p) => n + p.photos.length, 0),
    skippedPt: skipped.pt.length,
    skippedGym: skipped.gym.length,
  };
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------- execution

/**
 * Executes a plan. `storage` = { putPt(key, buf), putGym(key, buf) }, `avatarSink` = { write(fileName, buf), flush() }.
 * Each entity is handled in its own transaction under an advisory lock and re-checked (still no PUBLISHED photo / still no avatar).
 */
export async function applyPlan({ pools, plan, storage, avatarSink, log = () => {} }) {
  const added = { ptPhotoRows: 0, ptsPhotographed: 0, avatars: 0, gymPhotoRows: 0, gymsPhotographed: 0, raced: 0, objects: [] };

  // (b) avatars: files first (idempotent overwrite of a deterministic name), then the DB pointer only where still NULL
  const avatarsWritten = [];
  for (const a of plan.avatars) {
    const buf = await generateAvatarBuffer(a.uid, { size: 256 });
    await avatarSink.write(a.fileName, buf);
    avatarsWritten.push(a);
  }
  if (avatarsWritten.length) await avatarSink.flush();
  for (const a of avatarsWritten) {
    const r = await pools.user.query(
      `UPDATE user_profiles SET photo_url = $2, "updatedAt" = now() WHERE "userId" = $1 AND photo_url IS NULL AND "isPT" = true`,
      [a.uid, a.photoUrl]
    );
    added.avatars += r.rowCount ?? 0;
  }

  // (a) PT photos
  for (const p of plan.ptPhotos) {
    const c = await pools.user.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pt-photo-backfill:${p.uid}`]);
      const { rows } = await c.query(`SELECT 1 FROM pt_physique_photos WHERE pt_user_id = $1 AND status = 'PUBLISHED' LIMIT 1`, [p.uid]);
      if (rows.length) {
        added.raced++;
        await c.query("ROLLBACK");
        continue;
      }
      for (const ph of p.photos) {
        const body = readMasterByFile(ph.masterFile);
        await storage.putPt(ph.storageKey, body);
        added.objects.push({ bucket: PT_BUCKET, key: ph.storageKey });
        const res = await c.query(
          `INSERT INTO pt_physique_photos (id, pt_user_id, storage_key, status, sort_order, is_cover, mime, bytes, content_hash, uploaded_by, created_at)
           VALUES ($1, $2, $3, 'PUBLISHED'::"PtPhysiquePhotoStatus", $4, $5, 'image/webp', $6, $7, $2, now())
           ON CONFLICT DO NOTHING`,
          [ph.id, p.uid, ph.storageKey, ph.sortOrder, ph.isCover, body.length, sha256Hex(body)]
        );
        added.ptPhotoRows += res.rowCount ?? 0;
      }
      await c.query("COMMIT");
      added.ptsPhotographed++;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // (c) gym photos
  for (const g of plan.gymPhotos) {
    const c = await pools.gym.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`gym-photo-backfill:${g.gymId}`]);
      const { rows } = await c.query(`SELECT 1 FROM gym_photos WHERE gym_id = $1 AND status = 'PUBLISHED' LIMIT 1`, [g.gymId]);
      if (rows.length) {
        added.raced++;
        await c.query("ROLLBACK");
        continue;
      }
      for (const ph of g.photos) {
        const body = readMasterByFile(ph.masterFile);
        await storage.putGym(ph.s3Key, body);
        added.objects.push({ bucket: GYM_BUCKET, key: ph.s3Key });
        const res = await c.query(
          `INSERT INTO gym_photos (id, gym_id, file_name, sort_order, is_cover, s3_key, category, visibility, created_at, status, content_hash, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7::"GymPhotoCategory", 'PRIVATE'::"GymPhotoVisibility", now(), 'PUBLISHED'::"GymPhotoStatus", $8, $9)
           ON CONFLICT DO NOTHING`,
          [ph.id, g.gymId, ph.fileName, ph.sortOrder, ph.isCover, ph.s3Key, ph.category, sha256Hex(body), g.ownerId]
        );
        added.gymPhotoRows += res.rowCount ?? 0;
      }
      await c.query("COMMIT");
      added.gymsPhotographed++;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  log(`[backfill] added=${JSON.stringify({ ...added, objects: added.objects.length })}`);
  return added;
}

function readMasterByFile(relFile) {
  return fs.readFileSync(path.join(ASSETS_DIR, ...relFile.split("/")));
}

/** Read-only coverage counters used by the CLI and the tests. */
export async function coverageCounts(pools) {
  const pt = (
    await pools.user.query(
      `SELECT count(*)::int AS public_pts,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pt_physique_photos ph WHERE ph.pt_user_id = p."userId" AND ph.status = 'PUBLISHED'))::int AS with_photo,
              count(*) FILTER (WHERE p.photo_url IS NOT NULL AND p.photo_url <> '')::int AS with_avatar
       FROM user_profiles p JOIN pt_applications a ON a.user_profile_id = p.id
       WHERE p."isPT" = true AND p.pt_suspended = false AND a.status = 'APPROVED'
         AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT')`
    )
  ).rows[0];
  const gym = (
    await pools.gym.query(
      `SELECT count(*)::int AS public_gyms,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM gym_photos ph WHERE ph.gym_id = g.id AND ph.status = 'PUBLISHED' AND ph.is_cover))::int AS with_cover
       FROM gyms g WHERE g.status = 'APPROVED' AND g.operational_status = 'OPEN'`
    )
  ).rows[0];
  return { pt, gym };
}

// ---------------------------------------------------------------------------------------------------------------- storage adapters

export function makeMemoryStorage() {
  const objects = new Map();
  return {
    objects,
    async putPt(key, body) { objects.set(`${PT_BUCKET}/${key}`, body.length); },
    async putGym(key, body) { objects.set(`${GYM_BUCKET}/${key}`, body.length); },
  };
}

export function makeTempAvatarSink() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-avatars-"));
  return {
    dir,
    async write(fileName, buf) { fs.writeFileSync(path.join(dir, fileName), buf); },
    async flush() {},
  };
}

function dockerEnv(container, name) {
  return execFileSync("docker", ["exec", container, "printenv", name], { encoding: "utf8" }).trim();
}

/** Real dev MinIO (localhost:9000). Credentials come from SEED_MINIO_* or, failing that, from the dev containers' own env. Never printed. */
export function makeDevMinioStorage(env = process.env) {
  const { S3Client, PutObjectCommand } = loadAwsS3Sdk();
  const endpoint = env.SEED_MINIO_ENDPOINT || "http://localhost:9000";
  const mk = (accessKeyId, secretAccessKey) => new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  const ptClient = mk(
    env.SEED_MINIO_ACCESS_KEY || dockerEnv("gymcoach-user-dev", "PT_MEDIA_S3_ACCESS_KEY_ID"),
    env.SEED_MINIO_SECRET_KEY || dockerEnv("gymcoach-user-dev", "PT_MEDIA_S3_SECRET_ACCESS_KEY")
  );
  const gymClient = mk(
    env.SEED_MINIO_ACCESS_KEY || dockerEnv("gymcoach-gym-dev", "PARTNER_S3_ACCESS_KEY_ID"),
    env.SEED_MINIO_SECRET_KEY || dockerEnv("gymcoach-gym-dev", "PARTNER_S3_SECRET_ACCESS_KEY")
  );
  return {
    async putPt(key, body) { await ptClient.send(new PutObjectCommand({ Bucket: PT_BUCKET, Key: key, Body: body, ContentType: "image/webp" })); },
    async putGym(key, body) { await gymClient.send(new PutObjectCommand({ Bucket: GYM_BUCKET, Key: key, Body: body, ContentType: "image/webp" })); },
  };
}

/** Dev avatars: staged in a temp dir, then copied into the user-service uploads volume with `docker cp`. */
export function makeDevAvatarSink(container = "gymcoach-user-dev") {
  const tmp = makeTempAvatarSink();
  return {
    dir: tmp.dir,
    write: tmp.write,
    async flush() {
      execFileSync("docker", ["cp", `${tmp.dir}${path.sep}.`, `${container}:${USER_UPLOADS_DIR_IN_CONTAINER}/`], { stdio: "pipe" });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") o.target = argv[++i];
    else if (a === "--confirm") o.confirm = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--plan-out") o.planOut = argv[++i];
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveBackfillTarget({ target: args.target, confirm: args.confirm });
  const pools = makePools(target);
  try {
    const before = await coverageCounts(pools);
    console.log(`[backfill] target=${target.kind} before=${JSON.stringify(before)}`);
    const plan = await buildPlan({ pools });
    console.log(`[backfill] plan=${JSON.stringify(plan.counts)}`);
    for (const s of plan.skipped.pt) console.log(`[backfill] skipped PT ${s.uid}: ${s.reason}`);
    for (const s of plan.skipped.gym) console.log(`[backfill] skipped gym ${s.id}: ${s.reason}`);
    if (args.planOut) {
      const out = {
        objects: [
          ...plan.ptPhotos.flatMap((p) => p.photos.map((x) => ({ bucket: PT_BUCKET, key: x.storageKey }))),
          ...plan.gymPhotos.flatMap((g) => g.photos.map((x) => ({ bucket: GYM_BUCKET, key: x.s3Key }))),
        ],
        avatarFiles: plan.avatars.map((a) => ({ container: "gymcoach-user-dev", path: `${USER_UPLOADS_DIR_IN_CONTAINER}/${a.fileName}`, photoUrl: a.photoUrl })),
        counts: plan.counts,
        skipped: plan.skipped,
      };
      fs.mkdirSync(path.dirname(path.resolve(args.planOut)), { recursive: true });
      fs.writeFileSync(args.planOut, JSON.stringify(out, null, 2));
      console.log(`[backfill] plan written to ${args.planOut}`);
    }
    if (args.dryRun) {
      console.log("[backfill] --dry-run: nothing written");
      return;
    }
    const storage = target.kind === "dev" ? makeDevMinioStorage() : makeMemoryStorage();
    const avatarSink = target.kind === "dev" ? makeDevAvatarSink() : makeTempAvatarSink();
    const added = await applyPlan({ pools, plan, storage, avatarSink, log: console.log });
    const after = await coverageCounts(pools);
    console.log(`[backfill] after=${JSON.stringify(after)} summary=${JSON.stringify({ ...added, objects: added.objects.length })}`);
    fs.rmSync(avatarSink.dir, { recursive: true, force: true });
  } finally {
    await pools.user.end();
    await pools.gym.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[backfill] FAILED: ${e.message}`);
    process.exit(1);
  });
}
