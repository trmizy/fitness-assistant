#!/usr/bin/env node
/**
 * Loads scripts/seed-marketplace/data/geo/vietnam_ward_geo.json into user-service.vietnam_ward_geo.
 *
 * Allowed targets ONLY: --target test | --target scale | --target official (explicitly refuses --target dev or others).
 * Requires SEED_MARKETPLACE_CONFIRM=scale when using --target scale, SEED_MARKETPLACE_CONFIRM=official for --target official
 * (gymcoach_user_official; non-loopback host only with --allow-remote-host).
 * Idempotent: ON CONFLICT (ward_code) DO UPDATE ... WHERE row IS DISTINCT FROM EXCLUDED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertSeedAllowed, resolveTarget, SeedGuardError } from "./lib/guard.mjs";
import { chunk } from "./lib/util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GEO_PATH = path.resolve(here, "data", "geo", "vietnam_ward_geo.json");
export const EXPECTED_WARD_COUNT = 3321;
export const VN_CENTROID_BOUNDS = Object.freeze({ minLat: 6, maxLat: 24, minLng: 100, maxLng: 115 });
// Đặc khu Trường Sa (ward 22736) spans eastward to 117.828 E while its centroid remains <= 115 E.
export const VN_BBOX_BOUNDS = Object.freeze({ minLat: 6, maxLat: 24, minLng: 100, maxLng: 118 });
const ALLOWED_TARGETS = new Set(["test", "scale", "official"]);

/** Enforces load-ward-geo target rules: ONLY --target test or --target scale (never dev). */
export function assertLoadWardGeoAllowed(kind, { suffix = "seed_test", env = process.env, allowRemoteHost = false } = {}) {
  const normalizedKind = kind === undefined ? "test" : String(kind).toLowerCase();
  if (!ALLOWED_TARGETS.has(normalizedKind)) {
    throw new SeedGuardError(
      "TARGET_REFUSED",
      `load-ward-geo refuses --target "${normalizedKind}" (only --target test, scale or official is allowed).`,
    );
  }
  const target = resolveTarget({ kind: normalizedKind, suffix, env });
  const guard = assertSeedAllowed(target, { env, allowSharedTestDb: false, allowRemoteHost });
  if (!ALLOWED_TARGETS.has(guard.kind)) {
    throw new SeedGuardError("TARGET_REFUSED", `Unexpected guard target "${guard.kind}".`);
  }
  if (!target.dbs?.user) {
    throw new SeedGuardError("NO_TARGET", "Missing user database in resolved target.");
  }
  return { guard, target };
}

function inRange(v, min, max) {
  return Number.isFinite(v) && v >= min && v <= max;
}

/** Validates ward geo records and returns canonically sorted SQL-ready rows. */
export function prepareWardGeoRows(geoJson) {
  const wards = Array.isArray(geoJson?.wards) ? geoJson.wards : [];
  if (wards.length !== EXPECTED_WARD_COUNT) {
    throw new Error(`Expected ${EXPECTED_WARD_COUNT} wards in vietnam_ward_geo.json, got ${wards.length}`);
  }
  const seen = new Set();
  const rows = [];
  for (const w of wards) {
    const wardCode = Number(w.wardCode);
    const provinceCode = Number(w.provinceCode);
    if (!Number.isInteger(wardCode) || !Number.isInteger(provinceCode)) {
      throw new Error(`Invalid ward/province code: ${JSON.stringify(w.wardCode)}`);
    }
    if (seen.has(wardCode)) throw new Error(`Duplicate wardCode ${wardCode}`);
    seen.add(wardCode);

    const centroidLat = Number(w.centroidLat);
    const centroidLng = Number(w.centroidLng);
    const minLat = Number(w.minLat);
    const maxLat = Number(w.maxLat);
    const minLng = Number(w.minLng);
    const maxLng = Number(w.maxLng);
    const source = String(w.source || geoJson.source || "vietnamese-provinces-db-v5.2.0").trim();
    if (!source) throw new Error(`Empty source for ward ${wardCode}`);

    if (!inRange(centroidLat, VN_CENTROID_BOUNDS.minLat, VN_CENTROID_BOUNDS.maxLat)) {
      throw new Error(`Centroid latitude ${centroidLat} outside [${VN_CENTROID_BOUNDS.minLat}, ${VN_CENTROID_BOUNDS.maxLat}] for ward ${wardCode}`);
    }
    if (!inRange(centroidLng, VN_CENTROID_BOUNDS.minLng, VN_CENTROID_BOUNDS.maxLng)) {
      throw new Error(`Centroid longitude ${centroidLng} outside [${VN_CENTROID_BOUNDS.minLng}, ${VN_CENTROID_BOUNDS.maxLng}] for ward ${wardCode}`);
    }
    for (const lat of [minLat, maxLat]) {
      if (!inRange(lat, VN_BBOX_BOUNDS.minLat, VN_BBOX_BOUNDS.maxLat)) {
        throw new Error(`BBox latitude ${lat} outside [${VN_BBOX_BOUNDS.minLat}, ${VN_BBOX_BOUNDS.maxLat}] for ward ${wardCode}`);
      }
    }
    for (const lng of [minLng, maxLng]) {
      if (!inRange(lng, VN_BBOX_BOUNDS.minLng, VN_BBOX_BOUNDS.maxLng)) {
        throw new Error(`BBox longitude ${lng} outside [${VN_BBOX_BOUNDS.minLng}, ${VN_BBOX_BOUNDS.maxLng}] for ward ${wardCode}`);
      }
    }
    if (minLat > maxLat || minLng > maxLng) {
      throw new Error(`Inverted bbox for ward ${wardCode}`);
    }
    rows.push({ wardCode, provinceCode, centroidLat, centroidLng, minLat, maxLat, minLng, maxLng, source });
  }
  rows.sort((a, b) => a.wardCode - b.wardCode);
  return rows;
}

const UPSERT_SQL = `
  INSERT INTO "vietnam_ward_geo" (
    "ward_code", "province_code",
    "centroid_lat", "centroid_lng",
    "min_lat", "max_lat", "min_lng", "max_lng",
    "source"
  )
  SELECT * FROM UNNEST(
    $1::int[], $2::int[],
    $3::float8[], $4::float8[],
    $5::float8[], $6::float8[], $7::float8[], $8::float8[],
    $9::text[]
  )
  ON CONFLICT ("ward_code") DO UPDATE SET
    "province_code" = EXCLUDED."province_code",
    "centroid_lat"  = EXCLUDED."centroid_lat",
    "centroid_lng"  = EXCLUDED."centroid_lng",
    "min_lat"       = EXCLUDED."min_lat",
    "max_lat"       = EXCLUDED."max_lat",
    "min_lng"       = EXCLUDED."min_lng",
    "max_lng"       = EXCLUDED."max_lng",
    "source"        = EXCLUDED."source"
  WHERE (
    "vietnam_ward_geo"."province_code",
    "vietnam_ward_geo"."centroid_lat",
    "vietnam_ward_geo"."centroid_lng",
    "vietnam_ward_geo"."min_lat",
    "vietnam_ward_geo"."max_lat",
    "vietnam_ward_geo"."min_lng",
    "vietnam_ward_geo"."max_lng",
    "vietnam_ward_geo"."source"
  ) IS DISTINCT FROM (
    EXCLUDED."province_code",
    EXCLUDED."centroid_lat",
    EXCLUDED."centroid_lng",
    EXCLUDED."min_lat",
    EXCLUDED."max_lat",
    EXCLUDED."min_lng",
    EXCLUDED."max_lng",
    EXCLUDED."source"
  )
  RETURNING (xmax = 0) AS inserted;
`;

/** Verifies DB integrity checks required after loading vietnam_ward_geo. */
export async function verifyWardGeoInDb(client, expectedCount = EXPECTED_WARD_COUNT) {
  const countRes = await client.query(`SELECT count(*)::int AS n FROM "vietnam_ward_geo"`);
  const rowCount = countRes.rows[0].n;
  const fkMismatchRes = await client.query(`
    SELECT count(*)::int AS bad
    FROM "vietnam_ward_geo" g
    LEFT JOIN "vietnam_wards" w ON w.code = g.ward_code
    WHERE w.code IS NULL OR w.province_code <> g.province_code
  `);
  const missingWardRes = await client.query(`
    SELECT count(*)::int AS missing
    FROM "vietnam_wards" w
    LEFT JOIN "vietnam_ward_geo" g ON g.ward_code = w.code
    WHERE g.ward_code IS NULL
  `);
  const boundsRes = await client.query(
    `SELECT count(*)::int AS out_of_bounds
     FROM "vietnam_ward_geo"
     WHERE centroid_lat < $1 OR centroid_lat > $2
        OR centroid_lng < $3 OR centroid_lng > $4
        OR min_lat < $5 OR max_lat > $6
        OR min_lng < $7 OR max_lng > $8
        OR min_lat > max_lat OR min_lng > max_lng
        OR btrim(source) = ''`,
    [
      VN_CENTROID_BOUNDS.minLat,
      VN_CENTROID_BOUNDS.maxLat,
      VN_CENTROID_BOUNDS.minLng,
      VN_CENTROID_BOUNDS.maxLng,
      VN_BBOX_BOUNDS.minLat,
      VN_BBOX_BOUNDS.maxLat,
      VN_BBOX_BOUNDS.minLng,
      VN_BBOX_BOUNDS.maxLng,
    ],
  );
  const checks = {
    rowCount,
    fkAndProvinceMismatches: fkMismatchRes.rows[0].bad,
    missingFromWardsTable: missingWardRes.rows[0].missing,
    outOfBoundsOrEmptySource: boundsRes.rows[0].out_of_bounds,
  };
  if (
    checks.rowCount !== expectedCount ||
    checks.fkAndProvinceMismatches !== 0 ||
    checks.missingFromWardsTable !== 0 ||
    checks.outOfBoundsOrEmptySource !== 0
  ) {
    throw new Error(`Post-load verification failed: ${JSON.stringify(checks)}`);
  }
  return checks;
}

/** Loads vietnam_ward_geo.json idempotently into user-service.vietnam_ward_geo and verifies invariants. */
export async function loadWardGeoToDb({
  kind = "test",
  suffix = "seed_test",
  geoPath = DEFAULT_GEO_PATH,
  env = process.env,
  dryRun = false,
  allowRemoteHost = false,
} = {}) {
  const { guard, target } = assertLoadWardGeoAllowed(kind, { suffix, env, allowRemoteHost });
  const geoJson = JSON.parse(fs.readFileSync(geoPath, "utf8"));
  const rows = prepareWardGeoRows(geoJson);
  if (dryRun) {
    return { guard: guard.kind, database: target.dbs.user, dryRun: true, preparedRows: rows.length };
  }

  const pool = new pg.Pool({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.dbs.user,
    max: 2,
  });
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    const wardsCount = (await client.query(`SELECT count(*)::int AS n FROM "vietnam_wards"`)).rows[0].n;
    if (wardsCount < rows.length) {
      throw new Error(
        `Prerequisite vietnam_wards in ${target.dbs.user} has ${wardsCount} rows (expected >= ${rows.length}). Seed provinces/wards first.`,
      );
    }
    for (const batch of chunk(rows, 500)) {
      const res = await client.query(UPSERT_SQL, [
        batch.map((r) => r.wardCode),
        batch.map((r) => r.provinceCode),
        batch.map((r) => r.centroidLat),
        batch.map((r) => r.centroidLng),
        batch.map((r) => r.minLat),
        batch.map((r) => r.maxLat),
        batch.map((r) => r.minLng),
        batch.map((r) => r.maxLng),
        batch.map((r) => r.source),
      ]);
      for (const r of res.rows) {
        if (r.inserted) inserted++;
        else updated++;
      }
    }
    const verify = await verifyWardGeoInDb(client, rows.length);
    await client.query("COMMIT");
    return {
      guard: guard.kind,
      host: target.host,
      port: target.port,
      database: target.dbs.user,
      preparedRows: rows.length,
      inserted,
      updated,
      unchanged: rows.length - inserted - updated,
      verify,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function flag(name, fallback) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  const next = args[idx + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  loadWardGeoToDb({
    kind: flag("target", "test"),
    suffix: flag("suffix", "seed_test"),
    geoPath: flag("geo", DEFAULT_GEO_PATH),
    dryRun: !!flag("dry-run", false),
    allowRemoteHost: !!flag("allow-remote-host", false),
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(`[load-ward-geo] ${err.code || "ERROR"}: ${err.message}`);
      process.exit(1);
    });
}
