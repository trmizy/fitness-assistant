import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertLoadWardGeoAllowed,
  DEFAULT_GEO_PATH,
  EXPECTED_WARD_COUNT,
  prepareWardGeoRows,
} from "../load-ward-geo.mjs";

test("load-ward-geo guard: allows test and confirmed scale; refuses dev, fresh, partner, unconfirmed scale", () => {
  const testRes = assertLoadWardGeoAllowed("test", { suffix: "seed_test", env: {} });
  assert.equal(testRes.guard.kind, "test");
  assert.equal(testRes.target.dbs.user, "gymcoach_user_seed_test");

  const scaleRes = assertLoadWardGeoAllowed("scale", { env: { SEED_MARKETPLACE_CONFIRM: "scale" } });
  assert.equal(scaleRes.guard.kind, "scale");
  assert.equal(scaleRes.target.dbs.user, "gymcoach_user_scale");
  assert.equal(scaleRes.target.port, 55440);

  assert.throws(() => assertLoadWardGeoAllowed("dev", { env: { SEED_MARKETPLACE_CONFIRM: "dev" } }), { code: "TARGET_REFUSED" });
  assert.throws(() => assertLoadWardGeoAllowed("fresh", { env: {} }), { code: "TARGET_REFUSED" });
  assert.throws(() => assertLoadWardGeoAllowed("partner", { env: { SEED_MARKETPLACE_CONFIRM: "partner" } }), { code: "TARGET_REFUSED" });
  assert.throws(() => assertLoadWardGeoAllowed("scale", { env: {} }), { code: "CONFIRM_MISSING" });
  assert.throws(
    () => assertLoadWardGeoAllowed("test", { suffix: "seed_test", env: { NODE_ENV: "production" } }),
    { code: "PRODUCTION_REFUSED" },
  );
  assert.throws(
    () => assertLoadWardGeoAllowed("test", { suffix: "", env: {} }),
    { code: "DB_NOT_ALLOWLISTED" },
  );
});

test("prepareWardGeoRows: loads exact 3,321 wards sorted deterministically within Vietnam bounds", () => {
  const geoJson = JSON.parse(fs.readFileSync(DEFAULT_GEO_PATH, "utf8"));
  const rows = prepareWardGeoRows(geoJson);
  assert.equal(rows.length, EXPECTED_WARD_COUNT);
  assert.equal(rows[0].wardCode < rows[rows.length - 1].wardCode, true);

  const truongSa = rows.find((r) => r.wardCode === 22736);
  assert.ok(truongSa);
  assert.ok(truongSa.centroidLng >= 100 && truongSa.centroidLng <= 115);
  assert.ok(truongSa.maxLng <= 118);

  assert.throws(
    () =>
      prepareWardGeoRows({
        wards: rows.map((r, i) => (i === 0 ? { ...r, centroidLat: 30 } : r)),
      }),
    /outside/i,
  );
});
