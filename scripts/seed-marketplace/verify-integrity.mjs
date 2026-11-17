#!/usr/bin/env node
/**
 * verify-integrity.mjs - READ-ONLY cross-database checks of the marketplace seed.
 *   node scripts/seed-marketplace/verify-integrity.mjs --target test [--suffix seed_test]
 *   SEED_MARKETPLACE_CONFIRM=dev node scripts/seed-marketplace/verify-integrity.mjs --target dev
 *   SEED_MARKETPLACE_CONFIRM=official node scripts/seed-marketplace/verify-integrity.mjs --target official [--scale-factor 1] [--with-media] [--avatars-dir <dir>] [--allow-remote-host]
 *        official = BOTH suites: the business-seed checks below (11) and the scale-tier checks (8, lib/scale/integrity.mjs; check 7 media only with --with-media,
 *        which needs the explicit SEED_MINIO_* / PT_MEDIA_S3_BUCKET / PARTNER_S3_PRIVATE_BUCKET env).
 * Exit code 1 if any check FAILs or ERRORs. N/A (nothing to examine yet) is reported but does not fail.
 */
import { assertSeedAllowed, resolveTarget } from "./lib/guard.mjs";
import { runIntegrity } from "./lib/integrity.mjs";
import { closePools, makePools, seedDataPresent } from "./lib/tierA.mjs";
import { runScaleIntegrity } from "./lib/scale/integrity.mjs";
import { createScaleS3Clients } from "./lib/scale/media.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return d;
  const next = args[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
};
const kind = flag("target", "test");
const target = resolveTarget({ kind, suffix: flag("suffix", "seed_test") });
// reading does not need the "already seeded" gate, but the same marker / confirm / name rules apply
assertSeedAllowed(target, { reseed: true, allowSharedTestDb: !!flag("allow-shared-test-db", false), allowRemoteHost: !!flag("allow-remote-host", false) });
const pools = makePools(target);
try {
  console.log(`[verify-integrity] ${kind} ${target.host}:${target.port} ${Object.values(target.dbs).join(", ")}  seedPresent=${await seedDataPresent(pools)}`);
  const results = await runIntegrity(pools);
  let scaleResults = [];
  if (kind === "official") {
    // official = scale-tier SYNTHETIC history + REAL business seed on top: both suites must pass on the mixed data
    const withMedia = !!flag("with-media", false);
    const avatarsFlag = flag("avatars-dir", process.env.SEED_AVATARS_DIR || null);
    const avatarsDir = typeof avatarsFlag === "string" ? path.resolve(avatarsFlag) : path.join(path.dirname(fileURLToPath(import.meta.url)), ".runtime", "official", "profile-photos");
    scaleResults = await runScaleIntegrity({
      pools,
      scaleFactor: Number(flag("scale-factor", "1")),
      checkMedia: withMedia,
      avatarsDir,
      s3: withMedia ? createScaleS3Clients(process.env, { strict: true }) : null,
    });
    console.log("[verify-integrity] scale-tier suite");
    for (const r of scaleResults) console.log(`${r.status.padEnd(5)} ${r.name}  (examined ${r.examined}${r.violations.length ? `, ${r.violations.length} violations` : ""})`);
    for (const r of scaleResults) for (const v of r.violations.slice(0, 5)) console.log(`  - ${r.name}: ${JSON.stringify(v)}`);
    console.log("[verify-integrity] business-seed suite");
  }
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}  (examined ${r.examined}${r.violations.length ? `, ${r.violations.length} violations` : ""})`);
  for (const r of results) for (const v of r.violations.slice(0, 5)) console.log(`  - ${r.name}: ${JSON.stringify(v)}`);
  if ([...results, ...scaleResults].some((r) => r.status === "FAIL" || r.status === "ERROR")) process.exitCode = 1;
} finally {
  await closePools(pools);
}
