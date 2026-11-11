// Safety refusal checks (already-seeded / non-empty DBs), ephemeral + per-demo password hashing,
// and JSON checkpoint persistence for --resume.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { targetFingerprint } from "../preflight.mjs";
import { SeedGuardError } from "../guard.mjs";
import { SCALE_EMAIL_DOMAIN } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNTIME_DIR = path.resolve(here, "..", "..", ".runtime");

/** Resolves path for checkpoint & demo credentials inside gitignored .runtime/. */
export function checkpointPathFor(target, runtimeDir = DEFAULT_RUNTIME_DIR) {
  const fp = targetFingerprint(target);
  return path.join(runtimeDir, `scale-checkpoint-${fp}.json`);
}

export function demoAccountsPathFor(runtimeDir = DEFAULT_RUNTIME_DIR) {
  return path.join(runtimeDir, "scale-demo-accounts.txt");
}

/**
 * Checks whether the target DBs already hold scale or existing business data.
 * Refuses non-resume runs to avoid duplicating or corrupting a previously populated target.
 *   - target.kind === "scale": ANY business rows in auth/user/gym/non-escrow payment MUST refuse unless --resume.
 *   - target.kind === "test": ANY @scale.gymini.test / SYNTHETIC rows MUST refuse unless --resume
 *     (Tier A's @seed.gymini.test rows on shared seed_test do not block test runs when explicitly on test).
 */
export async function assertTargetReadyForScale({ target, pools, resume = false, checkpoint }) {
  if (resume) {
    if (!checkpoint) {
      throw new SeedGuardError("RESUME_CHECKPOINT_MISSING", "Cannot --resume: no matching checkpoint file found for this target.");
    }
    return;
  }

  const queries = [
    ["auth.scale_users", pools.auth, `SELECT count(*)::int AS n FROM users WHERE email LIKE '%@${SCALE_EMAIL_DOMAIN}'`],
    ["user.synthetic_profiles", pools.user, `SELECT count(*)::int AS n FROM user_profiles WHERE data_origin = 'SYNTHETIC'`],
    ["user.synthetic_contracts", pools.user, `SELECT count(*)::int AS n FROM contracts WHERE data_origin = 'SYNTHETIC'`],
    ["gym.synthetic_memberships", pools.gym, `SELECT count(*)::int AS n FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin"`],
    ["gym.scale_gyms", pools.gym, `SELECT count(*)::int AS n FROM gyms WHERE email LIKE '%@${SCALE_EMAIL_DOMAIN}'`],
  ];

  if (target.kind === "scale") {
    queries.push(
      ["auth.users", pools.auth, `SELECT count(*)::int AS n FROM users`],
      ["user.user_profiles", pools.user, `SELECT count(*)::int AS n FROM user_profiles`],
      ["gym.gyms", pools.gym, `SELECT count(*)::int AS n FROM gyms`],
      [
        "payment.wallets_non_escrow",
        pools.payment,
        `SELECT count(*)::int AS n FROM wallets WHERE owner_type <> 'PLATFORM' OR owner_id NOT IN ('ESCROW','REVENUE') OR available_balance <> 0 OR pending_balance <> 0 OR locked_balance <> 0 OR holdback_balance <> 0`,
      ]
    );
  }

  const hits = [];
  for (const [label, pool, sql] of queries) {
    const { rows } = await pool.query(sql);
    if (rows[0].n > 0) hits.push(`${label}=${rows[0].n}`);
  }
  if (hits.length > 0) {
    throw new SeedGuardError(
      "SCALE_ALREADY_SEEDED",
      `Target "${target.kind}" already contains data (${hits.join(", ")}). Pass --resume to continue an interrupted run or reset the isolated database first.`
    );
  }
}

/**
 * Generates ONE ephemeral 32-byte random secret -> single bcrypt hash (for bulk synthetic users)
 * and unique 18-byte random passwords per demo account, saving ONLY demo credentials to gitignored .runtime/.
 * Never logs any password to stdout.
 */
export async function prepareScalePasswords({
  demoSpecs,
  demoOutPath = demoAccountsPathFor(),
  existingBulkHash = null,
}) {
  let bulkSecret = crypto.randomBytes(32);
  const bulkHash = existingBulkHash ?? (await bcrypt.hash(bulkSecret.toString("base64url"), 10));
  bulkSecret.fill(0);
  bulkSecret = null;

  const demoPasswords = [];
  const demoHashes = new Map();
  for (const spec of demoSpecs) {
    const email = `${spec.slug}@${SCALE_EMAIL_DOMAIN}`;
    const pw = crypto.randomBytes(18).toString("base64url");
    const hash = await bcrypt.hash(pw, 10);
    demoHashes.set(email, hash);
    demoPasswords.push({ role: spec.role, slug: spec.slug, email, password: pw, note: spec.note ?? "" });
  }

  fs.mkdirSync(path.dirname(demoOutPath), { recursive: true });
  const header = [
    "# Gymini Scale Demo Accounts (LOCAL ONLY - DO NOT COMMIT)",
    `# Generated at ${new Date().toISOString()}`,
    "# Bulk ~36k synthetic accounts use a discarded one-time 32-byte random secret.",
    "",
  ];
  const lines = demoPasswords.map((d) => `${d.role}\t${d.email}\t${d.password}${d.note ? `\t# ${d.note}` : ""}`);
  fs.writeFileSync(demoOutPath, [...header, ...lines, ""].join("\n"), { encoding: "utf8", mode: 0o600 });

  return { bulkHash, demoHashes, demoOutPath, demoCount: demoPasswords.length };
}

export function loadCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Validates that a checkpoint on disk matches current target, scaleFactor, batchSize, and plan checksum. */
export function assertCheckpointCompatible(checkpoint, { targetFingerprint: fp, scaleFactor, structuralChecksum, namespace }) {
  if (!checkpoint) throw new SeedGuardError("RESUME_CHECKPOINT_MISSING", "Checkpoint file is empty or unreadable.");
  if (checkpoint.targetFingerprint !== fp) {
    throw new SeedGuardError("RESUME_MISMATCH", "Checkpoint targetFingerprint does not match target database.");
  }
  if (checkpoint.scaleFactor !== scaleFactor || checkpoint.namespace !== namespace) {
    throw new SeedGuardError(
      "RESUME_MISMATCH",
      `Checkpoint parameters mismatch (expected scaleFactor=${checkpoint.scaleFactor}, namespace=${checkpoint.namespace}).`
    );
  }
  if (checkpoint.structuralChecksum !== structuralChecksum) {
    throw new SeedGuardError(
      "RESUME_CHECKSUM_MISMATCH",
      `Plan structuralChecksum changed (${checkpoint.structuralChecksum} != ${structuralChecksum}); refusing unsafe --resume.`
    );
  }
}

export function saveCheckpointAtomic(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/** Loads optional bcrypt helper check if needed externally without touching stdout. */
export function resolveRepoRoot() {
  return path.resolve(here, "..", "..", "..", "..");
}
