import { guardedTest as dbTest, databaseNameOf } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "../generated/prisma";
import { findDuplicateLivePairs, formatReport } from "../scripts/contract-duplicate-pair-preflight";

/**
 * BR-27 / Codex #1 - the contracts_one_live_per_pair unique index must be INSTALLED by the deploy, or the deploy must stop.
 *
 * BACKEND INTEGRATION with the REAL `prisma migrate deploy` CLI, on a scratch database this test creates next to the one
 * DATABASE_URL points at (same server, name `<db>_mig<random>_test`) and drops at the end. Nothing else is touched.
 *
 *   1. clean database  -> migrate deploy applies every migration, the index exists.
 *   2. the state the first migration (20261021130000) could leave behind - index missing because duplicate live pairs
 *      existed - is rebuilt; then migrate deploy of 20261021140000_contract_one_live_per_pair_enforce FAILS LOUDLY
 *      ("MIGRATION BLOCKED"), the index is still missing, no contract row was deleted or changed.
 *   3. the preflight script reports exactly the duplicate pairs (read-only, no personal data) and exits 1.
 *   4. the documented remediation (cancel the unpaid duplicate, `migrate resolve --rolled-back`, deploy) succeeds, the index
 *      exists, and a second live contract for the pair is now refused by the database itself.
 */

const USER_DIR = path.resolve(__dirname, "../..");

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

function prismaCli(args: string[], databaseUrl: string) {
  const bin = require.resolve("prisma/build/index.js", { paths: [USER_DIR] });
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: USER_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 170_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

function preflightCli(databaseUrl: string) {
  const tsx = path.join(USER_DIR, "node_modules/tsx/dist/cli.mjs");
  const r = spawnSync(process.execPath, [tsx, "src/scripts/contract-duplicate-pair-preflight.ts"], {
    cwd: USER_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl, USER_DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

const ENFORCE = "20261021140000_contract_one_live_per_pair_enforce";

dbTest("migrate deploy: a clean database gets the index; a database with duplicate live pairs FAILS the deploy until they are resolved", { timeout: 400_000 }, async () => {
  const baseUrl = process.env.DATABASE_URL!;
  const scratchName = `${databaseNameOf(baseUrl).replace(/_test$/, "")}_mig${randomUUID().slice(0, 6)}_test`;
  assert.match(scratchName, /_test$/);
  const admin = new PrismaClient({ datasources: { db: { url: withDb(baseUrl, "postgres") } } });
  const scratchUrl = withDb(baseUrl, scratchName);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
  let db: PrismaClient | null = null;
  try {
    // 1. clean database
    const first = prismaCli(["migrate", "deploy"], scratchUrl);
    assert.equal(first.code, 0, first.out);
    db = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
    const hasIndex = async () =>
      Number(((await db!.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'`)) as any[])[0].n) === 1;
    assert.equal(await hasIndex(), true, "clean database: the index exists");
    const idx: any[] = await db.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'`);
    assert.match(idx[0].indexdef, /UNIQUE/);
    assert.match(idx[0].indexdef, /WHERE/);

    // 2. rebuild what the first migration could leave behind: no index + duplicates, enforce migration not yet applied
    await db.$executeRawUnsafe(`DROP INDEX "contracts_one_live_per_pair"`);
    await db.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${ENFORCE}'`);
    const pt = randomUUID();
    const client = randomUUID();
    const ids: Record<string, string> = {};
    const mk = async (key: string, ptUserId: string, clientUserId: string, status: string, source = "INDEPENDENT", paid = false) => {
      const id = randomUUID();
      ids[key] = id;
      await db!.contract.create({
        data: {
          id, ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, price: 1_000_000, status: status as any, source: source as any,
          ...(paid ? { paymentTransactionId: randomUUID() } : {}),
        },
      });
    };
    await mk("dupA", pt, client, "PENDING_PAYMENT");
    await mk("dupB", pt, client, "PENDING_REVIEW");
    // NOT duplicates: history, marketplace repeats, another pair
    await mk("old1", pt, client, "COMPLETED");
    await mk("old2", pt, client, "CANCELLED");
    await mk("mk1", pt, client, "ACTIVE", "MARKETPLACE");
    await mk("mk2", pt, client, "ACTIVE", "MARKETPLACE");
    await mk("other", pt, randomUUID(), "ACTIVE");
    const before: any[] = await db.$queryRawUnsafe(`SELECT id, status::text AS status FROM contracts ORDER BY id`);

    const blocked = prismaCli(["migrate", "deploy"], scratchUrl);
    assert.notEqual(blocked.code, 0, "the deploy must stop");
    assert.match(blocked.out, /MIGRATION BLOCKED/);
    assert.match(blocked.out, /contract-duplicate-pair-preflight/);
    assert.equal(await hasIndex(), false, "no index was created");
    const after: any[] = await db.$queryRawUnsafe(`SELECT id, status::text AS status FROM contracts ORDER BY id`);
    assert.deepEqual(after, before, "no contract row was deleted or changed");

    // 3. the preflight sees exactly the duplicate pair, read only, no personal data
    const report = await findDuplicateLivePairs(db as any);
    assert.equal(report.duplicatePairs, 1);
    assert.deepEqual(report.pairs[0].contracts.map((c) => c.contractId).sort(), [ids.dupA, ids.dupB].sort());
    assert.equal(report.pairs[0].verdict, "RESOLVABLE");
    assert.equal(report.pairs[0].keep, ids.dupA, "furthest along (PENDING_PAYMENT) is the suggested keeper");
    const text = formatReport(report);
    assert.ok(!text.includes(pt) && !text.includes(client), "the report carries no user ids");
    const cli = preflightCli(scratchUrl);
    assert.equal(cli.code, 1, cli.out);
    assert.match(cli.out, /BLOCKED: 1 PT-client pair/);
    await assert.rejects(
      () => db!.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); await tx.$executeRawUnsafe(`DELETE FROM contracts WHERE id = '${ids.dupA}'`); }),
      /read-only/i,
      "the preflight transaction mode is read only",
    );

    // 4. remediation through the documented procedure, then the deploy goes through
    await db.$executeRawUnsafe(`UPDATE contracts SET status = 'CANCELLED' WHERE id = '${ids.dupB}'`); // stands in for PATCH /contracts/:id/cancel
    assert.equal(preflightCli(scratchUrl).code, 0);
    const resolve = prismaCli(["migrate", "resolve", "--rolled-back", ENFORCE], scratchUrl);
    assert.equal(resolve.code, 0, resolve.out);
    const again = prismaCli(["migrate", "deploy"], scratchUrl);
    assert.equal(again.code, 0, again.out);
    assert.equal(await hasIndex(), true);
    await assert.rejects(() => mk("third", pt, client, "PENDING_REVIEW"), (e: any) => e?.code === "P2002");
    await mk("thirdMarketplace", pt, client, "ACTIVE", "MARKETPLACE"); // exempt
  } finally {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.$disconnect();
  }
});

dbTest("the enforce migration is a no-op when the index is already installed (the normal case)", async () => {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  try {
    const sql = (await import("node:fs")).readFileSync(
      path.join(USER_DIR, "prisma/migrations", ENFORCE, "migration.sql"),
      "utf8",
    );
    const idx: any[] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'`);
    assert.equal(idx[0].n, 1, "precondition: this test database has the index");
    // Re-running the migration body against a database that has the index must neither fail nor create anything.
    await db.$executeRawUnsafe(sql);
    const idx2: any[] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'`);
    assert.equal(idx2[0].n, 1);
  } finally {
    await db.$disconnect();
  }
});
