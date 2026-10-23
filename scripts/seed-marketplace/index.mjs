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
import fs from 'node:fs';
import path from 'node:path';
import { closePools, devPassword, makePools, runTierA, seedCounts, seedDataPresent, SeedCollisionError, assertNoCollisions, ensureSeedAdmin, seedAdmin } from "./lib/tierA.mjs";
import { checkFreshTarget } from "./lib/preflight.mjs";
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
    if (guard.kind === "fresh") await checkFreshTarget(target, pools, { reseed: gopts.reseed });
    await assertNoCollisions(pools, world);
    if (guard.kind === "fresh" || guard.kind === "partner") {
      const count = await ensureSeedAdmin(pools);
      log(`[seed] seed admin +${count} (${seedAdmin.email})`);
    }
    if (tier === "a" || tier === "all") {
      const r = await runTierA(pools, world, { log });
      log(`[seed] Tier A done: ${JSON.stringify(r)}`);
    }
    if (tier === "b" || tier === "all") {
      const gateway = flag("gateway", null);
      if (!gateway || gateway === true) throw new SeedGuardError("NO_GATEWAY", "Tier B needs --gateway <url> (a running stack whose databases ARE the target ones).");
      const ownedAdmin = guard.kind === "fresh" || guard.kind === "partner";
      const adminEmail = ownedAdmin ? seedAdmin.email : process.env.SEED_ADMIN_EMAIL;
      const adminPassword = ownedAdmin ? devPassword() : process.env.SEED_ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword) throw new SeedGuardError("NO_ADMIN", "Tier B needs SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.");
      const client = makeClient({ baseUrl: gateway, password: devPassword() });
      // the admin's own password differs from the seed password: log it in once through the same cache
      const adminLogin = await client.call("POST", "/auth/login", { body: { email: adminEmail, password: adminPassword }, expect: [200] });
      const adminToken = adminLogin.json?.accessToken;
      const ctx = makeTierBContext({ client, world, admin: { email: adminEmail }, password: devPassword(), log });
      client.preset?.(adminEmail, adminToken);
      const startedAt = Date.now();
      ctx.failFast = !!flag('fail-fast', false);
      let out;
      try {
        out = await runTierB(ctx, { only: flag('only', undefined)?.split(','), limit: flag('limit', undefined) === undefined ? undefined : Number(flag('limit')) });
      } finally {
        const evidence = flag('evidence', null);
        if (typeof evidence === 'string') {
          fs.mkdirSync(path.dirname(evidence), { recursive: true });
          fs.writeFileSync(evidence, JSON.stringify(redact({ ms: Date.now() - startedAt, stats: ctx.stats, errors: ctx.errors, warnings: ctx.warnings, requests: client.log }), null, 2));
        }
      }
      const businessWrites = client.log.filter(r => !['GET','HEAD','OPTIONS'].includes(r.method) && r.path !== '/auth/login' && r.status >= 200 && r.status < 300).length;
      log(`[seed] Tier B done: ${JSON.stringify(redact({ ms: out.ms, requests: out.requests, businessWrites, stats: out.stats, errors: out.errors.length, warnings: out.warnings.length }))}`);
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
