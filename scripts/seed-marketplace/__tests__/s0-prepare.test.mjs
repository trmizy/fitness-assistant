import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { analyzeManifest, C7_GYM_TARGET_BY_TOPIC, C7_PT_TARGET_BY_TOPIC } from "../review-assets.mjs";
import { gymPhotoPool, manifest, physiquePool, pickPhysique, resetPhysiqueCursor } from "../lib/world/assets.mjs";
import { generateAvatarBuffer, AVATAR_STYLES } from "../generate-avatars.mjs";
import { loadWardGeo, resetGeoSamplerCache, samplePointInWard } from "../lib/geo-sampler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..", "..", "..");
const req = createRequire(import.meta.url);
const sharp = req(path.join(rootDir, "backend", "services", "user-service", "node_modules", "sharp"));

test("assets audit (S0-bo-sung): 100% visually audited, C7 targets met (Gym >= 440, PT >= 625 ~50/50 gender), no missing files", () => {
  const report = analyzeManifest();
  assert.equal(report.summary.missingOnDisk.length, 0);
  assert.equal(report.summary.unauditedCount, 0);
  assert.equal(report.summary.pt.missingGender, 0);
  assert.ok(report.summary.gym.usable >= 440, `Expected Gym >= 440, got ${report.summary.gym.usable}`);
  assert.ok(report.summary.pt.usableNonRejected >= 625, `Expected PT >= 625, got ${report.summary.pt.usableNonRejected}`);
  for (const row of report.gymRows) {
    assert.ok(row.usable >= C7_GYM_TARGET_BY_TOPIC[row.topic], `Gym ${row.topic}: ${row.usable} < ${C7_GYM_TARGET_BY_TOPIC[row.topic]}`);
  }
  for (const row of report.ptRows) {
    assert.ok(row.usableNonRejected >= C7_PT_TARGET_BY_TOPIC[row.topic], `PT ${row.topic}: ${row.usableNonRejected} < ${C7_PT_TARGET_BY_TOPIC[row.topic]}`);
  }
  const maleShare = report.summary.pt.maleUsable / report.summary.pt.usableNonRejected;
  assert.ok(maleShare >= 0.45 && maleShare <= 0.55, `Expected balanced ~50/50 gender ratio, got ${(maleShare * 100).toFixed(1)}% MALE`);
});

test("assets pool filtering: gymPhotoPool excludes rejected and applies reclassifications; physiquePool enforces strict audit.gender", () => {
  const m = manifest();
  assert.ok(m.items.length >= 1065);
  assert.ok(m.totalBytes <= 15 * 1024 * 1024);

  const gymPool = gymPhotoPool();
  const allGym = Object.values(gymPool).flat();
  const allGymIds = new Set(allGym.map((x) => x.id));
  assert.ok(allGymIds.size >= 440);
  for (const rejectedId of [
    "pexels-35743073",
    "pexels-10473010",
    "pexels-10475451",
    "pexels-36887759",
    "pexels-6809658",
    "pexels-7195809",
    "pexels-12752465",
    "pexels-40317538",
  ]) {
    assert.equal(allGymIds.has(rejectedId), false, `${rejectedId} must be excluded`);
  }
  assert.equal(gymPool.exterior.some((x) => x.id === "pexels-40371833"), false);
  assert.equal(gymPool["gym-interior"].some((x) => x.id === "pexels-40371833"), true);
  assert.equal(gymPool["free-weights"].some((x) => x.id === "pexels-40371839"), true);
  assert.equal(gymPool.crossfit.some((x) => x.id === "pexels-7672106"), true);

  const pPool = physiquePool();
  assert.ok(pPool.length >= 625);
  for (const p of pPool) {
    assert.notEqual(p.audit?.status, "REJECTED");
    assert.ok(p.audit?.gender === "MALE" || p.audit?.gender === "FEMALE");
    assert.equal(typeof p.audit?.hasVisibleFace, "boolean");
  }
  resetPhysiqueCursor();
  const maleSample = pickPhysique("MALE", 5);
  assert.equal(maleSample.length, 5);
  assert.equal(maleSample.every((p) => p.audit.gender === "MALE"), true);
  const femaleSample = pickPhysique("FEMALE", 5);
  assert.equal(femaleSample.length, 5);
  assert.equal(femaleSample.every((p) => p.audit.gender === "FEMALE"), true);
});

test("vietnam_ward_geo.json: exact 34 provinces / 3,321 wards matching vietnam_provinces.json, no embedded polygons", () => {
  resetGeoSamplerCache();
  const refPath = path.join(rootDir, "backend", "services", "user-service", "prisma", "data", "vietnam_provinces.json");
  const refProvinces = JSON.parse(fs.readFileSync(refPath, "utf8"));
  const geo = loadWardGeo();

  assert.equal(geo.meta.provinceCount, 34);
  assert.equal(geo.meta.wardCount, 3321);
  assert.match(geo.meta.source, /vietnamese-provinces-database@v5\.2\.0/i);
  assert.match(geo.meta.osmExtractTimestamp, /^2026-11-/);

  const refWardSet = new Set();
  for (const p of refProvinces) {
    for (const w of p.wards) {
      refWardSet.add(w.code);
      const wg = geo.byWardCode.get(w.code);
      assert.ok(wg, `Missing ward ${w.code} in vietnam_ward_geo.json`);
      assert.equal(wg.provinceCode, p.code);
      assert.equal("geometry" in wg, false);
      assert.equal("coordinates" in wg, false);
      assert.ok(wg.urbanClass === "urban" || wg.urbanClass === "rural");
      assert.ok(Array.isArray(wg.anchors) && wg.anchors.length >= 1);
      for (const a of wg.anchors) {
        assert.ok(a.lat >= wg.minLat - 0.001 && a.lat <= wg.maxLat + 0.001);
        assert.ok(a.lng >= wg.minLng - 0.001 && a.lng <= wg.maxLng + 0.001);
      }
    }
  }
  assert.equal(refWardSet.size, 3321);
  assert.equal(geo.wards.length, 3321);
});

test("geo-sampler: deterministic point sampling for numeric and padded GIS ward codes", () => {
  const a1 = samplePointInWard(4, "seed-hanoi-badinh");
  const a2 = samplePointInWard("00004", "seed-hanoi-badinh");
  assert.deepEqual(a1, a2);
  assert.equal(a1.provinceCode, 1);
  assert.equal(a1.wardCode, 4);
  assert.equal(a1.urbanClass, "urban");

  const pq = samplePointInWard(31078, "seed-phu-quoc");
  assert.equal(pq.wardCode, 31078);
  assert.ok(pq.latitude > 9.9 && pq.latitude < 10.6);
  assert.ok(pq.longitude > 103.8 && pq.longitude < 104.2);

  assert.throws(() => samplePointInWard(999999, "bad"));
});

test("generate-avatars: deterministic 256x256 WebP output across only CC0 styles", async () => {
  assert.deepEqual(AVATAR_STYLES, ["lorelei", "notionists", "open-peeps"]);
  const b1 = await generateAvatarBuffer("pt-test-001", { style: "notionists" });
  const b2 = await generateAvatarBuffer("pt-test-001", { style: "notionists" });
  assert.equal(Buffer.compare(b1, b2), 0);

  const meta = await sharp(b1).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);

  const b3 = await generateAvatarBuffer("client-test-002");
  assert.notEqual(Buffer.compare(b1, b3), 0);
});

test("default fallback placeholders exist as valid non-empty WebPs", async () => {
  for (const name of ["pt-default.webp", "gym-default.webp"]) {
    const p = path.join(rootDir, "scripts", "seed-marketplace", "assets", "defaults", name);
    assert.equal(fs.existsSync(p), true);
    const meta = await sharp(p).metadata();
    assert.equal(meta.format, "webp");
    assert.ok(meta.width >= 600);
  }
});

