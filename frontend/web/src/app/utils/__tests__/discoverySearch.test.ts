/** Run: npx tsx --test src/app/utils/__tests__/discoverySearch.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGymSearchBody,
  buildPtSearchBody,
  collabQueryKeys,
  formatGymDistanceBadge,
  formatKmVi,
  formatPtDistanceBadge,
  gymDiscoveryKeys,
  isCursorResetError,
  isSearchRegionReady,
  nextRadiusStep,
  normalizeVnCoords,
  ptDiscoveryKeys,
  resolveEffectiveScope,
  roundCoord3,
} from "../discoverySearch";

describe("discoverySearch GPS rounding & bounds", () => {
  it("rounds coordinates to 3 decimals and drops out-of-VN coordinates", () => {
    assert.equal(roundCoord3(10.7764891), 10.776);
    assert.equal(roundCoord3(106.70089), 106.701);
    assert.deepEqual(normalizeVnCoords({ lat: 10.776489, lng: 106.70089 }), {
      lat: 10.776,
      lng: 106.701,
    });
    assert.equal(normalizeVnCoords({ lat: 7.9, lng: 106.7 }), null);
    assert.equal(normalizeVnCoords({ lat: 21.02, lng: 110.2 }), null);
    assert.equal(normalizeVnCoords({ lat: Number.NaN, lng: 106.7 }), null);
  });

  it("excludes GPS coords when national scope is active", () => {
    const body = buildPtSearchBody({
      gpsCoords: { lat: 10.77648, lng: 106.70149 },
      provinceCode: 79,
      wardCode: 26740,
      national: true,
    });
    assert.equal(body.scope, "national");
    assert.equal(body.lat, undefined);
    assert.equal(body.lng, undefined);
    assert.equal(body.areaProvince, undefined);
    assert.equal(body.areaWard, undefined);
    assert.equal(body.radiusKm, undefined);
  });

  it("embeds 3-decimal rounded GPS coords in POST body (never raw floats) and omits empty filters", () => {
    const body = buildPtSearchBody({
      gpsCoords: { lat: 10.77648, lng: 106.70149 },
      radiusKm: 20,
      specialties: ["Strength", "  ", "Yoga"],
      q: "  khoa  ",
    });
    assert.deepEqual(body, {
      scope: "near",
      mode: "ANY",
      sortBy: "default",
      limit: 20,
      lat: 10.776,
      lng: 106.701,
      radiusKm: 20,
      filters: {
        q: "khoa",
        specialties: ["Strength", "Yoga"],
      },
    });
  });

  it("builds Gyms search payload cleanly across near / province / national", () => {
    assert.equal(resolveEffectiveScope({ national: false, hasGps: false, provinceCode: 79, wardCode: null }), "province");
    assert.equal(resolveEffectiveScope({ national: false, hasGps: false, provinceCode: 79, wardCode: 26734 }), "near");
    const gymBody = buildGymSearchBody({
      provinceCode: 79,
      wardCode: 26734,
      amenityIds: ["wifi", "sauna"],
      priceMax: 500_000,
      sort: "distance",
    });
    assert.deepEqual(gymBody, {
      scope: "near",
      sort: "distance",
      limit: 20,
      radiusKm: 10,
      areaProvince: 79,
      areaWard: 26734,
      amenityIds: ["wifi", "sauna"],
      priceMax: 500_000,
    });
  });
});

describe("discoverySearch distance labels & radius stepping", () => {
  it("formats Vietnamese decimal distances and PT badges accurately", () => {
    assert.equal(formatKmVi(3.24), "3,2");
    assert.deepEqual(
      formatPtDistanceBadge({ distanceKm: 3.2, distanceBasis: "GPS" }),
      { kind: "GPS", text: "~3,2 km (đường chim bay)" },
    );
    assert.deepEqual(
      formatPtDistanceBadge(
        { distanceKm: 4.5, distanceBasis: "WARD_CENTER" },
        { selectedWardName: "Phường Bến Nghé", appliedScope: "near" },
      ),
      { kind: "WARD_CENTER", text: "~4,5 km từ trung tâm Phường Bến Nghé" },
    );
    assert.deepEqual(
      formatPtDistanceBadge(
        { distanceKm: null, distanceBasis: null, ptApplication: { serviceMode: "HYBRID" } },
        { appliedScope: "near", requestedMode: "ANY" },
      ),
      { kind: "ONLINE", text: "Dạy online" },
    );
    assert.deepEqual(
      formatPtDistanceBadge(
        { distanceKm: null, distanceBasis: null, ptApplication: { serviceMode: "OFFLINE" } },
        { appliedScope: "province", requestedMode: "ANY" },
      ),
      { kind: "NONE", text: null },
    );
  });

  it("derives GymsPage distance labels from active GPS vs WARD_CENTER", () => {
    assert.deepEqual(
      formatGymDistanceBadge({ distanceKm: 1.8, appliedScope: "near", hasGps: true, selectedWardName: "P. Bến Nghé" }),
      { kind: "GPS", text: "~1,8 km (đường chim bay)" },
    );
    assert.deepEqual(
      formatGymDistanceBadge({ distanceKm: 2.6, appliedScope: "near", hasGps: false, selectedWardName: "P. Bến Nghé" }),
      { kind: "WARD_CENTER", text: "~2,6 km từ trung tâm P. Bến Nghé" },
    );
    assert.deepEqual(
      formatGymDistanceBadge({ distanceKm: 2.6, appliedScope: "province", hasGps: false, selectedWardName: "P. Bến Nghé" }),
      { kind: "NONE", text: null },
    );
  });

  it("steps radius 10 -> 20 -> 50 -> null", () => {
    assert.equal(nextRadiusStep(10), 20);
    assert.equal(nextRadiusStep(20), 50);
    assert.equal(nextRadiusStep(50), null);
    assert.equal(nextRadiusStep(undefined), 20);
  });
});

describe("discoverySearch 409 cursor handling & user isolation keys", () => {
  it("recognizes 409 CURSOR_EXPIRED and CURSOR_FILTER_MISMATCH only", () => {
    assert.equal(isCursorResetError({ response: { status: 409, data: { code: "CURSOR_EXPIRED" } } }), "CURSOR_EXPIRED");
    assert.equal(
      isCursorResetError({ response: { status: 409, data: { error: { code: "CURSOR_FILTER_MISMATCH" } } } }),
      "CURSOR_FILTER_MISMATCH",
    );
    assert.equal(isCursorResetError({ response: { status: 409, data: { code: "PACKAGE_CHANGED" } } }), null);
    assert.equal(isCursorResetError({ response: { status: 400, data: { code: "CURSOR_EXPIRED" } } }), null);
  });

  it("isolates React Query keys strictly by authenticated userId", () => {
    const keysA = ptDiscoveryKeys("user-a");
    const keysB = ptDiscoveryKeys("user-b");
    assert.notDeepEqual(keysA.profileRegion(), keysB.profileRegion());
    assert.notDeepEqual(keysA.search(buildPtSearchBody({})), keysB.search(buildPtSearchBody({})));
    assert.notDeepEqual(gymDiscoveryKeys("user-a").search(buildGymSearchBody({})), gymDiscoveryKeys("user-b").search(buildGymSearchBody({})));
    assert.notDeepEqual(collabQueryKeys("pt-1", "PT").brandOptions("cali"), collabQueryKeys("pt-2", "PT").brandOptions("cali"));
  });
});


describe("isSearchRegionReady (no stale national search before the saved area resolves)", () => {
  it("waits for the saved region of THIS user before the first search", () => {
    assert.equal(isSearchRegionReady({ userId: "u1", hydratedForUserId: null }), false);
    assert.equal(isSearchRegionReady({ userId: "u1", hydratedForUserId: "u1" }), true);
  });

  it("never reuses the previous account's hydration after an account switch", () => {
    assert.equal(isSearchRegionReady({ userId: "u2", hydratedForUserId: "u1" }), false);
  });

  it("does not block when the profile read failed (national is then the right scope) or when logged out", () => {
    assert.equal(isSearchRegionReady({ userId: "u1", hydratedForUserId: null, profileRegionFailed: true }), true);
    assert.equal(isSearchRegionReady({ userId: null, hydratedForUserId: null }), true);
    assert.equal(isSearchRegionReady({ userId: undefined }), true);
  });

  it("first fired request carries the saved area, not scope:national (simulated page sequence)", () => {
    const fired: unknown[] = [];
    const render = (s: { hydratedFor: string | null; provinceCode: number | null; national: boolean }) => {
      if (!isSearchRegionReady({ userId: "u1", hydratedForUserId: s.hydratedFor })) return;
      fired.push(
        buildGymSearchBody({ gpsCoords: null, provinceCode: s.provinceCode, wardCode: null, national: s.national, limit: 20 }),
      );
    };
    // render 1: defaults, profile still loading -> nothing fires
    render({ hydratedFor: null, provinceCode: null, national: true });
    // render 2: saved province 79 applied together with the hydration marker -> the single, correct search
    render({ hydratedFor: "u1", provinceCode: 79, national: false });
    assert.equal(fired.length, 1);
    assert.equal((fired[0] as any).scope, "province");
    assert.equal((fired[0] as any).areaProvince, 79);
  });
});
