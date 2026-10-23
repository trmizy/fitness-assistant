#!/usr/bin/env node
/**
 * verify-integrity.mjs - READ-ONLY cross-database checks of the marketplace seed.
 *   node scripts/seed-marketplace/verify-integrity.mjs --target test [--suffix seed_test]
 *   SEED_MARKETPLACE_CONFIRM=dev node scripts/seed-marketplace/verify-integrity.mjs --target dev
 * Exit code 1 if any check FAILs or ERRORs. N/A (nothing to examine yet) is reported but does not fail.
 */
import { assertSeedAllowed, resolveTarget } from "./lib/guard.mjs";
import { runIntegrity } from "./lib/integrity.mjs";
import { closePools, makePools, seedDataPresent } from "./lib/tierA.mjs";

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
assertSeedAllowed(target, { reseed: true, allowSharedTestDb: !!flag("allow-shared-test-db", false) });
const pools = makePools(target);
try {
  console.log(`[verify-integrity] ${kind} ${target.host}:${target.port} ${Object.values(target.dbs).join(", ")}  seedPresent=${await seedDataPresent(pools)}`);
  const results = await runIntegrity(pools);
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}  (examined ${r.examined}${r.violations.length ? `, ${r.violations.length} violations` : ""})`);
  for (const r of results) for (const v of r.violations.slice(0, 5)) console.log(`  - ${r.name}: ${JSON.stringify(v)}`);
  if (results.some((r) => r.status === "FAIL" || r.status === "ERROR")) process.exitCode = 1;
} finally {
  await closePools(pools);
}
