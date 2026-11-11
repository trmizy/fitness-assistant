// BACKEND INTEGRATION on isolated test container (localhost:55433, gymcoach_*_scale_seed_test).
// Skipped unless SEED_MARKETPLACE_RUN_DB_TESTS=true. Never touches dev DBs, scale DBs (55440), or lane A *_test DBs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveTarget, SeedGuardError, SERVICES } from "../lib/guard.mjs";
import { closePools, makePools } from "../lib/tierA.mjs";
import { runScaleSeed } from "../lib/scale/runner.mjs";
import { runScaleIntegrity } from "../lib/scale/integrity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, "..", "index.mjs");

let enabled = process.env.SEED_MARKETPLACE_RUN_DB_TESTS === "true";
const target = resolveTarget({ kind: "test", suffix: "scale_seed_test" });

async function resetFromTemplate(svcTarget) {
  const adminClient = new pg.Client({
    host: svcTarget.host,
    port: svcTarget.port,
    user: svcTarget.user,
    password: svcTarget.password,
    database: "postgres",
  });
  await adminClient.connect();
  try {
    for (const s of SERVICES) {
      const tpl = `gymcoach_${s}_scale_tpl_test`;
      const { rows } = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [tpl]);
      if (rows.length === 0) return false;
      const dbName = svcTarget.dbs[s];
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${dbName}" TEMPLATE "${tpl}"`);
    }
    return true;
  } finally {
    await adminClient.end();
  }
}

let ready = false;
if (enabled) {
  try {
    ready = await resetFromTemplate(target);
  } catch {
    ready = false;
  }
}
const opts = { skip: ready ? false : "Scale DB integration requires SEED_MARKETPLACE_RUN_DB_TESTS=true and scale_tpl_test on localhost:55433" };

function makeInMemoryS3() {
  const buckets = new Map([["gymini-user-media", new Map()], ["gymini-partner-private", new Map()]]);
  class PutObjectCommand { constructor(input) { this.type = "put"; this.input = input; } }
  class CopyObjectCommand { constructor(input) { this.type = "copy"; this.input = input; } }
  class ListObjectsV2Command { constructor(input) { this.type = "list"; this.input = input; } }
  const client = {
    async send(cmd) {
      if (cmd.type === "put") { buckets.get(cmd.input.Bucket).set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === "copy") {
        const [b, ...k] = cmd.input.CopySource.split("/");
        buckets.get(cmd.input.Bucket).set(cmd.input.Key, buckets.get(b).get(k.join("/")));
        return {};
      }
      if (cmd.type === "list") {
        return {
          Contents: [...buckets.get(cmd.input.Bucket).keys()]
            .filter((k) => k.startsWith(cmd.input.Prefix || ""))
            .map((Key) => ({ Key })),
          IsTruncated: false,
        };
      }
      throw new Error(`unexpected ${cmd.type}`);
    },
  };
  return {
    s3: { ptClient: client, gymClient: client, ptBucket: "gymini-user-media", gymBucket: "gymini-partner-private" },
    commands: { PutObjectCommand, CopyObjectCommand, ListObjectsV2Command },
  };
}

test("CLI refuses --tier scale on --target dev and missing confirm on --target scale", () => {
  assert.throws(
    () => execFileSync(process.execPath, [cliPath, "--target", "dev", "--tier", "scale"], { stdio: "pipe" }),
    (err) => err.status === 3 && /TARGET_REFUSED|REFUSED/.test(err.stderr.toString())
  );
  assert.throws(
    () => execFileSync(process.execPath, [cliPath, "--target", "scale", "--tier", "scale"], { env: { ...process.env, SEED_MARKETPLACE_CONFIRM: "" }, stdio: "pipe" }),
    (err) => err.status === 3 && /CONFIRM_MISSING/.test(err.stderr.toString())
  );
});

test("scale-seed integration (--scale-factor 0.01): writes all DBs, inert finances, mock MinIO+avatars, refuses rerun & catches injected corruption", opts, async () => {
  const pools = makePools(target);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scale-it-"));
  const avatarsDir = path.join(tmpDir, "avatars");
  const mock = makeInMemoryS3();

  try {
    const out = await runScaleSeed({
      target,
      pools,
      scaleFactor: 0.01,
      batchSize: 50,
      skipMedia: false,
      runtimeDir: tmpDir,
      avatarsDir,
      s3: mock.s3,
      s3Commands: mock.commands,
      log: () => {},
    });
    assert.equal(out.metrics.integrityPassed, true);
    assert.equal(out.integrityResults.length, 7);
    assert.equal(out.integrityResults.every((r) => r.status === "PASS"), true);

    // Generated member_code populated by PostgreSQL & all scale gyms marked SYNTHETIC
    const { rows: mcRows } = await pools.gym.query(`SELECT count(*)::int AS n FROM gym_membership_contracts WHERE member_code IS NOT NULL AND length(member_code) = 8`);
    assert.ok(mcRows[0].n > 0);
    const { rows: synGyms } = await pools.gym.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE data_origin = 'SYNTHETIC'::"DataOrigin")::int AS syn FROM gyms WHERE email LIKE '%@scale.gymini.test'`
    );
    assert.ok(synGyms[0].total > 0);
    assert.equal(synGyms[0].total, synGyms[0].syn);

    // Non-resume re-run MUST be refused cleanly
    await assert.rejects(
      () => runScaleSeed({ target, pools, scaleFactor: 0.01, skipMedia: true, runtimeDir: tmpDir, log: () => {} }),
      (e) => e instanceof SeedGuardError && e.code === "SCALE_ALREADY_SEEDED"
    );

    // Fault injection 1: non-EXPIRED SYNTHETIC membership fails check 4
    await pools.gym.query(`UPDATE gym_membership_contracts SET status = 'ACTIVE' WHERE id = (SELECT id FROM gym_membership_contracts LIMIT 1)`);
    let badRes = await runScaleIntegrity({ pools, scaleFactor: 0.01, checkMedia: false });
    assert.equal(badRes.find((r) => r.name.startsWith("4.")).status, "FAIL");
    await pools.gym.query(`UPDATE gym_membership_contracts SET status = 'EXPIRED'`);

    // Fault injection 2: stray payment_transactions referencing a scale user fails check 4
    const uRow = await pools.auth.query(`SELECT id FROM users WHERE email LIKE '%@scale.gymini.test' LIMIT 1`);
    await pools.payment.query(
      `INSERT INTO payment_transactions (id, payer_id, purpose, amount, idempotency_key, updated_at) VALUES ('it-pay-bad', $1, 'PT_CONTRACT', 100000, 'it-pay-key', now())`,
      [uRow.rows[0].id]
    );
    badRes = await runScaleIntegrity({ pools, scaleFactor: 0.01, checkMedia: false });
    assert.equal(badRes.find((r) => r.name.startsWith("4.")).status, "FAIL");
    await pools.payment.query(`DELETE FROM payment_transactions WHERE id = 'it-pay-bad'`);

    // Fault injection 3: scale gym flipped to REAL fails check 3 AND check 5 (SYNTHETIC reviews/memberships pointing to non-SYNTHETIC gym)
    const revGymRow = await pools.gym.query(`SELECT DISTINCT gym_id AS id FROM gym_reviews WHERE data_origin = 'SYNTHETIC'::"DataOrigin" LIMIT 1`);
    const memGymRow = await pools.gym.query(`SELECT DISTINCT gym_id AS id FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin" LIMIT 1`);
    assert.ok(revGymRow.rows.length > 0 && memGymRow.rows.length > 0);
    const faultGymIds = [...new Set([revGymRow.rows[0].id, memGymRow.rows[0].id])];
    const updateGymOrigin = async (origin) => {
      const c = await pools.gym.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL gymini.compat_writer = 'seed'");
        await c.query(`UPDATE gyms SET data_origin = $1::"DataOrigin" WHERE id = ANY($2::text[])`, [origin, faultGymIds]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };
    await updateGymOrigin("REAL");
    badRes = await runScaleIntegrity({ pools, scaleFactor: 0.01, checkMedia: false });
    const badCheck3 = badRes.find((r) => r.name.startsWith("3."));
    const badCheck5 = badRes.find((r) => r.name.startsWith("5."));
    assert.equal(badCheck3.status, "FAIL");
    assert.equal(badCheck3.violations.some((v) => v.why === "scale gym data_origin != SYNTHETIC"), true);
    assert.equal(badCheck5.status, "FAIL");
    assert.equal(badCheck5.violations.some((v) => v.why === "SYNTHETIC gym_reviews points to missing/non-SYNTHETIC gym"), true);
    assert.equal(badCheck5.violations.some((v) => v.why === "SYNTHETIC gym_membership_contracts points to missing/non-SYNTHETIC gym"), true);
    await updateGymOrigin("SYNTHETIC");

    const cleanRes = await runScaleIntegrity({ pools, scaleFactor: 0.01, checkMedia: false });
    assert.equal(cleanRes.every((r) => r.status === "PASS"), true);
  } finally {
    await closePools(pools);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("scale-seed --resume recovers cleanly after partial phase run and verifies prior batch", opts, async () => {
  await resetFromTemplate(target);
  const pools = makePools(target);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scale-res-"));
  try {
    // Phase 1 only: auth + gym-core
    await runScaleSeed({
      target,
      pools,
      scaleFactor: 0.01,
      batchSize: 50,
      only: "auth,gym-core",
      skipMedia: true,
      runtimeDir: tmpDir,
      log: () => {},
    });

    // Resume all remaining phases
    const resumed = await runScaleSeed({
      target,
      pools,
      scaleFactor: 0.01,
      batchSize: 50,
      resume: true,
      skipMedia: true,
      runtimeDir: tmpDir,
      log: () => {},
    });
    assert.equal(resumed.metrics.integrityPassed, true);
    assert.equal(resumed.integrityResults.every((r) => r.status === "PASS"), true);
  } finally {
    await closePools(pools);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

