#!/usr/bin/env node
/**
 * Marketplace seed (Phase G2). Production-like clients / PTs / Gym Owners / branches / listings. Deterministic and idempotent.
 *
 *   node scripts/seed-marketplace/index.mjs --target test [--suffix seed_test]      Tier A on dedicated *_seed_test DBs
 *   node scripts/seed-marketplace/index.mjs --target test --counts                  just print the seed row counts
 *   node scripts/seed-marketplace/index.mjs --tier b --dry-run                      Tier B request plan, nothing is sent
 *   SEED_MARKETPLACE_CONFIRM=dev node scripts/seed-marketplace/index.mjs --target dev [--reseed] --tier all \
 *        --gateway http://localhost:3000       (needs verify-clean.ok + SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD + the compose override of SEED.md)
 *
 * Tier A = direct DB fixtures (accounts, profiles, InBody). Tier B = the real flows over HTTP through the gateway.
 * Guards: see lib/guard.mjs. The password is never printed. Nothing here ever deletes or updates an existing row.
 */
import { assertSeedAllowed, resolveTarget, SeedGuardError } from "./lib/guard.mjs";
import { closePools, devPassword, makePools, runTierA, seedCounts, seedDataPresent, SeedCollisionError } from "./lib/tierA.mjs";
import { buildWorld, summarize } from "./lib/world/index.mjs";
import { makeClient, redact } from "./lib/tierB/client.mjs";
import { describeTierB, makeTierBContext, runTierB } from "./lib/tierB/run.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return d;
  const next = args[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
};

async function main() {
  const kind = flag("target", "test");
  const tier = String(flag("tier", "a")).toLowerCase();
  const dryRun = !!flag("dry-run", false);
  const world = buildWorld();
  const log = (m) => console.log(m);

  if (flag("summary", false)) {
    console.log(JSON.stringify(summarize(world), null, 2));
    return;
  }

  if (tier === "b" && dryRun) {
    // No database, no network: records every request Tier B WOULD send.
    const client = makeClient({ dryRun: true, password: "x" });
    const ctx = makeTierBContext({ client, world, admin: { email: "admin.placeholder@seed.gymini.test" }, password: "x", log: () => {} });
    const out = await runTierB(ctx);
    console.log(JSON.stringify({ plan: describeTierB(world), dryRun: { requests: out.requests, stats: out.stats, errors: out.errors, warnings: out.warnings.length } }, null, 2));
    return;
  }

  const target = resolveTarget({ kind, suffix: flag("suffix", "seed_test") });
  const pools = makePools(target);
  try {
    // 1. the guard decides BEFORE any connection is made (a refused run never touches a database, not even to read)
    const gopts = { reseed: !!flag("reseed", false), allowSharedTestDb: !!flag("allow-shared-test-db", false) };
    let guard = assertSeedAllowed(target, gopts);
    // 2. on dev only: has the seed already run? then --reseed is required (ensure-only, deletes nothing)
    if (guard.kind === "dev") guard = assertSeedAllowed(target, { ...gopts, seedDataPresent: await seedDataPresent(pools).catch(() => false) });
    log(`[seed] guard OK (${guard.kind}) ${target.host}:${target.port} ${Object.values(target.dbs).join(", ")}`);
    if (flag("counts", false)) {
      console.log(JSON.stringify(await seedCounts(pools), null, 2));
      return;
    }
    if (tier === "a" || tier === "all") {
      const r = await runTierA(pools, world, { log });
      log(`[seed] Tier A done: ${JSON.stringify(r)}`);
    }
    if (tier === "b" || tier === "all") {
      const gateway = flag("gateway", null);
      if (!gateway || gateway === true) throw new SeedGuardError("NO_GATEWAY", "Tier B needs --gateway <url> (a running stack whose databases ARE the target ones).");
      if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) throw new SeedGuardError("NO_ADMIN", "Tier B needs SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (the admin kept after the DB clean-up).");
      const client = makeClient({ baseUrl: gateway, password: devPassword() });
      // the admin's own password differs from the seed password: log it in once through the same cache
      const adminLogin = await client.call("POST", "/auth/login", { body: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }, expect: [200] });
      const adminToken = adminLogin.json?.accessToken;
      const ctx = makeTierBContext({ client, world, admin: { email: process.env.SEED_ADMIN_EMAIL }, password: devPassword(), log });
      client.preset?.(process.env.SEED_ADMIN_EMAIL, adminToken);
      const out = await runTierB(ctx);
      log(`[seed] Tier B done: ${JSON.stringify(redact({ requests: out.requests, stats: out.stats, errors: out.errors.length, warnings: out.warnings.length }))}`);
      if (out.errors.length) process.exitCode = 2;
    }
    log(`[seed] counts: ${JSON.stringify(await seedCounts(pools))}`);
  } finally {
    await closePools(pools);
  }
}

main().catch((e) => {
  if (e instanceof SeedGuardError || e instanceof SeedCollisionError) {
    console.error(`[seed] REFUSED (${e.code ?? e.name}): ${e.message}`);
    process.exit(3);
  }
  console.error("[seed] FAILED:", e.message);
  process.exit(1);
});
