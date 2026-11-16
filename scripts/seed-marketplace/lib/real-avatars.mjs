// Deterministic DiceBear avatars for the REAL business-seed accounts (@seed.gymini.test) of the OFFICIAL (thesis) database.
//
// Why: the scale tier gives every SYNTHETIC PT an avatar (/uploads/profile-photos/<userId>.webp), the REAL accounts used to have
// photo_url NULL, and REAL PTs sort early in PT discovery -> the first page showed many PTs without an avatar.
//
// Same generator + same URL shape as the scale tier and the real local upload path (profile.controller.ts: `/uploads/profile-photos/<file>`):
// generateAvatarBuffer(userId, { size: 256 }) = CC0 DiceBear style (lorelei / notionists / open-peeps) picked from the id, Gymini palette
// swatch, 256x256 WebP. The file name is <userId>.webp and photo_url = `/uploads/profile-photos/<userId>.webp`.
//
// Roles covered: EVERY user_profiles row on the seed domain with photo_url IS NULL (PTs, clients and - if user-service has already created a
// profile for them - gym owners). It is the same cheap code path for all roles, so there is no reason to restrict it to PTs.
//
// Safety:
//   - only rows whose e-mail is on @seed.gymini.test; @scale.gymini.test and every other account (incl. PROTECTED_EMAILS) are never selected;
//   - the UPDATE re-checks `photo_url IS NULL` and the domain, so a photo uploaded by a user between plan and apply is never overwritten;
//   - idempotent: eligibility is recomputed from the DB, a second run plans (and writes) nothing;
//   - the only statement that writes to the DB is that guarded UPDATE of user_profiles.photo_url (+ "updatedAt").
import fs from "node:fs";
import path from "node:path";
import { generateAvatarBuffer } from "../generate-avatars.mjs";
import { SEED_EMAIL_DOMAIN } from "./util.mjs";

export const REAL_AVATAR_URL_PREFIX = "/uploads/profile-photos/";
/** Accounts whose data these scripts must never touch (lower-case e-mails). Mirrors backfill-dev-photos.mjs. */
export const REAL_AVATAR_PROTECTED_EMAILS = Object.freeze(["huytronh4@gmail.com"]);
/** The only container the optional `--docker-cp` copy may target (the dev user-service). */
export const OFFICIAL_USER_CONTAINER = "gymcoach-user-dev";
export const USER_UPLOADS_DIR_IN_CONTAINER = "/app/backend/services/user-service/uploads/profile-photos";

const SEED_LIKE = `%@${SEED_EMAIL_DOMAIN}`;

/** Read-only: REAL seed profiles that still have no avatar. */
export async function planRealAvatars(userPool) {
  const { rows } = await userPool.query(
    `SELECT "userId" AS uid, lower(email) AS email, "isPT" AS is_pt
       FROM user_profiles
      WHERE lower(email) LIKE $1 AND photo_url IS NULL AND NOT (lower(email) = ANY($2::text[]))
      ORDER BY "userId"`,
    [SEED_LIKE, REAL_AVATAR_PROTECTED_EMAILS]
  );
  return rows.map((r) => ({
    uid: r.uid,
    isPt: r.is_pt,
    fileName: `${r.uid}.webp`,
    photoUrl: `${REAL_AVATAR_URL_PREFIX}${r.uid}.webp`,
  }));
}

/**
 * Writes the avatar files into `avatarsDir` (a file that already exists and is non-empty is kept: content is deterministic) and then
 * points photo_url at them, only where photo_url is still NULL. An avatar whose row was filled meanwhile is deleted again (no orphan).
 */
export async function applyRealAvatars({ userPool, plan, avatarsDir, log = () => {} }) {
  fs.mkdirSync(avatarsDir, { recursive: true });
  const out = { planned: plan.length, filesWritten: 0, filesKept: 0, rowsUpdated: 0, raced: 0, files: [] };
  for (const a of plan) {
    const filePath = path.join(avatarsDir, a.fileName);
    let created = false;
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      out.filesKept++;
    } else {
      fs.writeFileSync(filePath, await generateAvatarBuffer(a.uid, { size: 256 }));
      out.filesWritten++;
      created = true;
    }
    const r = await userPool.query(
      `UPDATE user_profiles SET photo_url = $2, "updatedAt" = now()
        WHERE "userId" = $1 AND photo_url IS NULL AND lower(email) LIKE $3 AND NOT (lower(email) = ANY($4::text[]))`,
      [a.uid, a.photoUrl, SEED_LIKE, REAL_AVATAR_PROTECTED_EMAILS]
    );
    if (r.rowCount) {
      out.rowsUpdated += r.rowCount;
      out.files.push(a.fileName);
    } else {
      out.raced++;
      if (created) fs.rmSync(filePath, { force: true });
    }
  }
  log(`[real-avatars] dir=${avatarsDir} planned=${out.planned} rowsUpdated=${out.rowsUpdated} filesWritten=${out.filesWritten} filesKept=${out.filesKept} raced=${out.raced}`);
  return out;
}

/** Read-only counters (REAL = seed domain). `publicPts` uses the same definition as ptPublicWhere in user-service. */
export async function realAvatarCounts(userPool) {
  const { rows } = await userPool.query(
    `SELECT count(*)::int AS profiles,
            count(*) FILTER (WHERE photo_url IS NOT NULL AND photo_url <> '')::int AS with_avatar,
            count(*) FILTER (WHERE "isPT" = true)::int AS pts,
            count(*) FILTER (WHERE "isPT" = true AND photo_url IS NOT NULL AND photo_url <> '')::int AS pts_with_avatar,
            count(*) FILTER (WHERE "isPT" = true AND pt_suspended = false
              AND EXISTS (SELECT 1 FROM pt_applications a WHERE a.user_profile_id = p.id AND a.status = 'APPROVED')
              AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT'))::int AS public_pts,
            count(*) FILTER (WHERE "isPT" = true AND pt_suspended = false AND photo_url IS NOT NULL AND photo_url <> ''
              AND EXISTS (SELECT 1 FROM pt_applications a WHERE a.user_profile_id = p.id AND a.status = 'APPROVED')
              AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT'))::int AS public_pts_with_avatar
       FROM user_profiles p WHERE lower(email) LIKE $1`,
    [SEED_LIKE]
  );
  return rows[0];
}
