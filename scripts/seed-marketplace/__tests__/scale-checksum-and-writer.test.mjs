import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PT_TERMS_VERSION, scaledCounts } from "../lib/scale/config.mjs";
import { buildScaleUniverse } from "../lib/scale/data-generators.mjs";
import { loadUsableMasterPools } from "../lib/scale/media.mjs";
import {
  BatchReconciliationError,
  buildUnnestInsertSql,
  reconcileBatchCounts,
  writeBatchWithReconciliation,
} from "../lib/scale/db-writer.mjs";
import {
  assertCheckpointCompatible,
  assertTargetReadyForScale,
  checkpointPathFor,
  prepareScalePasswords,
  saveCheckpointAtomic,
  loadCheckpoint,
} from "../lib/scale/checkpoint.mjs";
import { SeedGuardError } from "../lib/guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

test("PT_TERMS_VERSION in scale config matches user-service pt-terms.ts", () => {
  const src = fs.readFileSync(path.join(repoRoot, "backend", "services", "user-service", "src", "services", "pt-terms.ts"), "utf8");
  const m = src.match(/export const PT_TERMS_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(m, "PT_TERMS_VERSION constant found in pt-terms.ts");
  assert.equal(PT_TERMS_VERSION, m[1]);
});

test("structural checksum is deterministic across runs and excludes random secrets", async () => {
  const pools = loadUsableMasterPools();
  const counts = scaledCounts(0.01);
  const u1 = buildScaleUniverse({ counts, masterPools: pools });
  const u2 = buildScaleUniverse({ counts, masterPools: pools });
  assert.equal(u1.structuralChecksum, u2.structuralChecksum);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scale-pw-"));
  try {
    const p1 = await prepareScalePasswords({ demoSpecs: u1.demoAuthSpecs, demoOutPath: path.join(tmpDir, "a.txt") });
    const p2 = await prepareScalePasswords({ demoSpecs: u2.demoAuthSpecs, demoOutPath: path.join(tmpDir, "b.txt") });
    assert.notEqual(p1.bulkHash, p2.bulkHash, "each run draws an independent 32-byte ephemeral bulk secret");
    assert.match(p1.bulkHash, /^\$2[aby]\$10\$/);
    assert.equal(fs.readFileSync(path.join(tmpDir, "a.txt"), "utf8").split(/\r?\n/).some((l) => l.includes("demo-scale-admin@scale.gymini.test")), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test("buildUnnestInsertSql encodes array and enum[] columns safely without N-row bind explosion", () => {
  const cols = [
    { name: "id", cast: "text" },
    { name: "specialties", kind: "text[]" },
    { name: "facilities", kind: "enum[]", enumType: '"GymFacility"' },
  ];
  const { sql, params } = buildUnnestInsertSql("gyms", cols, [{ id: "g1", specialties: ["Yoga"], facilities: ["WIFI"] }]);
  assert.equal(params.length, 3);
  assert.match(sql, /UNNEST\(\$1::text\[\], \$2::jsonb\[\], \$3::jsonb\[\]\)/);
  assert.match(sql, /::"GymFacility"/);
});

test("writeBatchWithReconciliation backfills once on partial drop and throws BatchReconciliationError on persistent mismatch", async () => {
  const cols = [{ name: "id", cast: "text" }];
  const rows = [{ id: "r1" }, { id: "r2" }];

  // Mock pool 1: initial insert drops r2, reconciliation sees count=1, backfill recovers r2 -> PASS
  let stored = new Set();
  let phase = "init";
  const recoveringPool = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
          if (sql.startsWith("SET LOCAL gymini.compat_writer")) return { rows: [] };
          if (sql.includes("INSERT INTO") && phase === "init") {
            stored.add("r1");
            phase = "backfill";
            return { rowCount: 1 };
          }
          if (sql.includes("INSERT INTO") && phase === "backfill") {
            for (const id of params[0]) stored.add(id);
            return { rowCount: 1 };
          }
          if (sql.includes("SELECT count(*)")) return { rows: [{ n: [...params[0]].filter((id) => stored.has(id)).length }] };
          if (sql.includes("SELECT id FROM")) return { rows: [...stored].map((id) => ({ id })) };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const ok = await writeBatchWithReconciliation({ pool: recoveringPool, table: "gyms", columns: cols, rows, batchIndex: 0, setCompatWriter: true });
  assert.equal(ok.expected, 2);
  assert.equal(ok.actual, 2);
  assert.equal(ok.backfilled, 1);

  // Mock pool 2: persistent failure triggers ROLLBACK and BatchReconciliationError
  let rolledBack = false;
  const failingPool = {
    async connect() {
      return {
        async query(sql) {
          if (sql === "ROLLBACK") { rolledBack = true; return { rows: [] }; }
          if (sql.includes("SELECT count(*)")) return { rows: [{ n: 1 }] };
          if (sql.includes("SELECT id FROM")) return { rows: [{ id: "r1" }] };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  await assert.rejects(
    () => writeBatchWithReconciliation({ pool: failingPool, table: "gyms", columns: cols, rows, batchIndex: 3 }),
    BatchReconciliationError
  );
  assert.equal(rolledBack, true);
  await assert.rejects(() => reconcileBatchCounts({ pool: failingPool, table: "gyms", rows, batchIndex: 3 }), BatchReconciliationError);
});

test("assertTargetReadyForScale refuses already-seeded DBs without --resume and validates checkpoint compatibility", async () => {
  const target = { kind: "scale", host: "localhost", port: 55440, dbs: { auth: "a", user: "u", gym: "g", payment: "p" } };
  const fakePool = (n) => ({ async query() { return { rows: [{ n }] }; } });
  const dirtyPools = { auth: fakePool(5), user: fakePool(0), gym: fakePool(0), payment: fakePool(0) };

  await assert.rejects(
    () => assertTargetReadyForScale({ target, pools: dirtyPools, resume: false }),
    (e) => e instanceof SeedGuardError && e.code === "SCALE_ALREADY_SEEDED"
  );
  await assert.rejects(
    () => assertTargetReadyForScale({ target, pools: dirtyPools, resume: true, checkpoint: null }),
    (e) => e instanceof SeedGuardError && e.code === "RESUME_CHECKPOINT_MISSING"
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scale-cp-"));
  try {
    const cpPath = checkpointPathFor(target, tmpDir);
    saveCheckpointAtomic(cpPath, {
      targetFingerprint: targetFingerprintStub(cpPath),
      scaleFactor: 1,
      namespace: "gymini-scale-v1",
      structuralChecksum: "abc123",
    });
    const loaded = loadCheckpoint(cpPath);
    assert.throws(
      () => assertCheckpointCompatible(loaded, { targetFingerprint: loaded.targetFingerprint, scaleFactor: 1, namespace: "gymini-scale-v1", structuralChecksum: "OTHER" }),
      (e) => e.code === "RESUME_CHECKSUM_MISMATCH"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

function targetFingerprintStub(cpPath) {
  return path.basename(cpPath).replace(/^scale-checkpoint-|\.json$/g, "");
}

