import test from "node:test";
import assert from "node:assert/strict";
import { C3_PROVINCES, scaledCounts } from "../lib/scale/config.mjs";
import { allocateBranchesGeo, allocateOwnerBranchPlan, allocatePeopleLocations, hamiltonProvinceQuotas } from "../lib/scale/geo-allocator.mjs";
import { buildScaleUniverse } from "../lib/scale/data-generators.mjs";
import { loadUsableMasterPools } from "../lib/scale/media.mjs";
import { loadWardGeo } from "../lib/geo-sampler.mjs";
import { rngFrom } from "../lib/scale/rng.mjs";

test("hamiltonProvinceQuotas distributes exact totals over 34 C3 provinces within 1 unit", () => {
  const q = hamiltonProvinceQuotas(2500, C3_PROVINCES);
  assert.equal(q.size, 34);
  const sum = [...q.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, 2500);
  for (const p of C3_PROVINCES) {
    assert.ok((q.get(p.code) ?? 0) >= 1, `province ${p.code} should have >=1 gym`);
  }
});

test("scaleFactor=1 splits exact 700 standalone + 180 medium [2..5] + 20 large [15..90] = 2,500 branches", () => {
  const rng = rngFrom("test-split-v1");
  const counts = scaledCounts(1);
  const owners = allocateOwnerBranchPlan(rng, counts);
  assert.equal(owners.length, 900);

  const stand = owners.filter((o) => o.kind === "standalone");
  const med = owners.filter((o) => o.kind === "medium");
  const large = owners.filter((o) => o.kind === "large");

  assert.equal(stand.length, 700);
  assert.equal(med.length, 180);
  assert.equal(large.length, 20);
  assert.equal(stand.every((o) => o.branchCount === 1), true);
  assert.equal(med.every((o) => o.branchCount >= 2 && o.branchCount <= 5), true);
  assert.equal(large.every((o) => o.branchCount >= 15 && o.branchCount <= 90), true);
  assert.equal(owners.reduce((s, o) => s + o.branchCount, 0), 2500);
});

test("scaleFactor=1 meets C3 ±0.5%, <=6 provinces/large chain, >=40% ward coverage & urban weight", () => {
  const counts = scaledCounts(1);
  const wardGeo = loadWardGeo();
  const rng = rngFrom("test-geo-full");
  const owners = allocateOwnerBranchPlan(rng, counts);
  const { branchAssignmentsByOwner, branchGeoByKey } = allocateBranchesGeo(owners, counts, rng, wardGeo);

  const allBranches = [];
  for (const o of owners) {
    const provs = branchAssignmentsByOwner.get(o.ownerIdx);
    assert.equal(provs.length, o.branchCount);
    if (o.kind === "large") {
      assert.ok(new Set(provs).size <= 6, `large chain ${o.ownerIdx} spanned > 6 provinces`);
    }
    if (o.kind === "medium") {
      assert.ok(new Set(provs).size <= 2, `medium chain spanned > 2 provinces`);
    }
    for (let i = 0; i < provs.length; i++) {
      allBranches.push(branchGeoByKey.get(`${o.ownerIdx}:${i}`));
    }
  }
  assert.equal(allBranches.length, 2500);

  const byProv = new Map();
  for (const b of allBranches) {
    byProv.set(b.provinceCode, (byProv.get(b.provinceCode) ?? 0) + 1);
    const wb = wardGeo.byWardCode.get(b.wardCode);
    assert.equal(wb.provinceCode, b.provinceCode);
    assert.ok(b.latitude >= wb.minLat - 0.002 && b.latitude <= wb.maxLat + 0.002);
    assert.ok(b.longitude >= wb.minLng - 0.002 && b.longitude <= wb.maxLng + 0.002);
  }
  for (const c3 of C3_PROVINCES) {
    const actualPct = ((byProv.get(c3.code) ?? 0) * 100) / 2500;
    assert.ok(Math.abs(actualPct - c3.pct) <= 0.5, `C3 drift for ${c3.code}: ${actualPct} vs ${c3.pct}`);
  }

  const coveredWards = new Set(allBranches.map((b) => b.wardCode)).size;
  assert.ok(coveredWards / 3321 >= 0.4, `ward coverage ${(coveredWards / 3321 * 100).toFixed(2)}% < 40%`);
  const urbanPct = allBranches.filter((b) => b.urbanClass === "urban").length / allBranches.length;
  assert.ok(urbanPct >= 0.55, `urban concentration ${(urbanPct * 100).toFixed(1)}% unexpectedly low`);
});

test("scaleFactor=0.01 produces proportional world matching C2/C5 status and review constraints", () => {
  const counts = scaledCounts(0.01);
  const u = buildScaleUniverse({ counts, masterPools: loadUsableMasterPools() });
  const uData = u.buildUserStaticTables();

  assert.equal(u.customers.length, 250);
  assert.equal(u.pts.length, 108); // 100 public + 8 other (1 per non-public bucket)
  assert.equal(u.branches.length, 25);
  assert.equal(u.pts.filter((p) => p.isPublic && p.serviceMode === "ONLINE").every((p) => p.locations.length === 0), true);
  assert.equal(u.pts.filter((p) => p.isPublic && p.serviceMode !== "ONLINE").every((p) => p.locations.length >= 1), true);
  assert.equal(uData.ptLocations.filter((l) => l.gym_id).length > 0, true);

  // Verify every HYBRID public PT has both ONLINE and OFFLINE active packages
  for (const pt of u.pts.filter((p) => p.isPublic && p.serviceMode === "HYBRID")) {
    const active = pt.packages.filter((k) => k.isActive);
    assert.ok(active.some((k) => k.sessionMode === "ONLINE"), `HYBRID PT ${pt.slug} missing ONLINE pkg`);
    assert.ok(active.some((k) => k.sessionMode === "OFFLINE"), `HYBRID PT ${pt.slug} missing OFFLINE pkg`);
  }

  // Review distribution sums exactly to target & all contracts COMPLETED / EXPIRED
  let totalRevs = 0;
  for (const b of u.iterSessionReviewBatches(500)) totalRevs += b.length;
  assert.equal(totalRevs, counts.sessionReviews);
  for (const b of u.iterContractBatches(500)) {
    assert.equal(b.every((c) => c.status === "COMPLETED" && c.data_origin === "SYNTHETIC"), true);
  }
  for (const b of u.iterGymMembershipBatches(500)) {
    assert.equal(b.every((m) => m.status === "EXPIRED" && m.data_origin === "SYNTHETIC"), true);
  }
});

test("allocatePeopleLocations preserves exact count and valid ward/province mappings", () => {
  const rng = rngFrom("people-loc-test");
  const wardGeo = loadWardGeo();
  const locs = allocatePeopleLocations(500, [], wardGeo, rng, "people");
  assert.equal(locs.length, 500);
  for (const l of locs) {
    const wg = wardGeo.byWardCode.get(l.wardCode);
    assert.ok(wg);
    assert.equal(wg.provinceCode, l.provinceCode);
  }
});

