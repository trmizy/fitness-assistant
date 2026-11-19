/**
 * U2 discovery — the pure logic behind the mobile PT / gym search: distance wording (plan v2.2.5), request bodies
 * (3-decimal GPS, body only), cursor paging + the 409 reload, the one-shot GPS reading, area-code-only persistence,
 * brand-option paging and the X-Gymini-Client header.
 *
 * TEST FIXTURE level — no device, no network. Runs with: npx tsx --test src/features/__tests__/discoverySearch.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RADIUS_KM,
  PHOTO_ATTRIBUTION_LINK,
  PHOTO_ATTRIBUTION_TEXT,
  RADIUS_STEPS,
  brandOptionsParams,
  buildGymSearchBody,
  buildPtSearchBody,
  collabBrandOptionsKey,
  emptyResultTitle,
  formatGymDistanceBadge,
  formatKmVi,
  formatPtDistanceBadge,
  gymDiscoveryKeys,
  gpsProblemText,
  isCursorResetError,
  mergeBrandOptionPages,
  mergeUniquePages,
  nextCursorParam,
  nextRadiusStep,
  normalizeVnCoords,
  photoAttributionLine,
  ptDetailParams,
  ptDiscoveryKeys,
  readGpsOnce,
  regionPayload,
  regionSummaryText,
  resolveEffectiveScope,
  roundCoord3,
  shouldResetCursor,
  withCursor,
} from "../services/discoverySearch";
import { normalizeGym, normalizeMembership } from "../services/gymDirectory";
import { CLIENT_HEADER, clientHeaderValue, clientIdentityHeaders, listingFlowHeaders } from "../../services/listingFlow";

const axiosError = (status: number, data: unknown) => ({ response: { status, data } });

describe("distance wording (plan v2.2.5)", () => {
  it("GPS → '~x km (đường chim bay)' with a Vietnamese decimal comma", () => {
    assert.deepEqual(formatPtDistanceBadge({ distanceKm: 3.2, distanceBasis: "GPS" }), {
      kind: "GPS",
      text: "~3,2 km (đường chim bay)",
    });
  });
  it("ward centre → '~x km từ trung tâm <phường>'", () => {
    assert.equal(
      formatPtDistanceBadge({ distanceKm: 1.5, distanceBasis: "WARD_CENTER" }, { selectedWardName: "Phường Tân Định" }).text,
      "~1,5 km từ trung tâm Phường Tân Định",
    );
  });
  it("ward centre without a known ward name still never invents a place", () => {
    assert.equal(formatPtDistanceBadge({ distanceKm: 1.5, distanceBasis: "WARD_CENTER" }).text, "~1,5 km từ trung tâm phường");
  });
  it("province only / national → no distance at all", () => {
    const view = formatPtDistanceBadge({ distanceKm: null, distanceBasis: null }, { appliedScope: "province", requestedMode: "ANY" });
    assert.deepEqual(view, { kind: "NONE", text: null });
    assert.deepEqual(formatPtDistanceBadge({ distanceKm: null, distanceBasis: null }, { appliedScope: "national" }), { kind: "NONE", text: null });
  });
  it("a distance with no basis is not shown (basis is the contract, not the number)", () => {
    assert.equal(formatPtDistanceBadge({ distanceKm: 4, distanceBasis: null }).text, null);
  });
  it("online PTs read 'Dạy online' — by tier, by mode filter, and as the near-search online fallback", () => {
    assert.equal(formatPtDistanceBadge({ distanceKm: null, distanceBasis: null, ptApplication: { serviceMode: "ONLINE" } }).text, "Dạy online");
    assert.equal(formatPtDistanceBadge({ distanceKm: null, distanceBasis: null }, { requestedMode: "ONLINE" }).text, "Dạy online");
    assert.equal(
      formatPtDistanceBadge({ distanceKm: null, distanceBasis: null, ptApplication: { serviceMode: "HYBRID" } }, { appliedScope: "near" }).text,
      "Dạy online",
    );
  });
  it("an offline PT with a real distance keeps the distance, not the online label", () => {
    assert.equal(
      formatPtDistanceBadge({ distanceKm: 2.4, distanceBasis: "GPS", ptApplication: { serviceMode: "HYBRID" } }, { appliedScope: "near" }).kind,
      "GPS",
    );
  });
  it("gym badge: GPS wins; ward only when the server really searched near; province/national show nothing", () => {
    assert.equal(formatGymDistanceBadge({ distanceKm: 1.2, hasGps: true, appliedScope: "near" }).text, "~1,2 km (đường chim bay)");
    assert.equal(
      formatGymDistanceBadge({ distanceKm: 1.2, hasGps: false, appliedScope: "near", selectedWardName: "Phường 1" }).text,
      "~1,2 km từ trung tâm Phường 1",
    );
    assert.equal(formatGymDistanceBadge({ distanceKm: 1.2, hasGps: false, appliedScope: "province", selectedWardName: "Phường 1" }).text, null);
    assert.equal(formatGymDistanceBadge({ distanceKm: null, hasGps: true }).text, null);
  });
  it("formatKmVi rounds to one decimal", () => {
    assert.equal(formatKmVi(3.24), "3,2");
    assert.equal(formatKmVi(10), "10,0");
  });
});

describe("radius expansion", () => {
  it("steps 10 → 20 → 50 → none", () => {
    assert.deepEqual([...RADIUS_STEPS], [10, 20, 50]);
    assert.equal(nextRadiusStep(10), 20);
    assert.equal(nextRadiusStep(20), 50);
    assert.equal(nextRadiusStep(50), null);
    assert.equal(nextRadiusStep(undefined), 20);
    assert.equal(nextRadiusStep(DEFAULT_RADIUS_KM), 20);
  });
  it("the empty-result headline names the radius only for a radius search", () => {
    assert.equal(emptyResultTitle("pt", "near", 10), "Không tìm thấy huấn luyện viên trong bán kính 10 km");
    assert.equal(emptyResultTitle("gym", "near", 20), "Không tìm thấy phòng gym trong bán kính 20 km");
    assert.equal(emptyResultTitle("pt", "province", 10), "Không tìm thấy PT phù hợp với bộ lọc hiện tại.");
  });
});

describe("GPS rounding and the request body (coordinates: 3 decimals, POST body only)", () => {
  it("rounds to 3 decimals and rejects points outside Vietnam / non-finite", () => {
    assert.equal(roundCoord3(10.77649), 10.776);
    assert.equal(roundCoord3(106.7015), 106.702);
    assert.deepEqual(normalizeVnCoords({ lat: 10.77612, lng: 106.70098 }), { lat: 10.776, lng: 106.701 });
    assert.equal(normalizeVnCoords({ lat: 40.7, lng: -74 }), null);
    assert.equal(normalizeVnCoords({ lat: 10.7, lng: 150 }), null);
    assert.equal(normalizeVnCoords({ lat: Number.NaN, lng: 106 }), null);
    assert.equal(normalizeVnCoords({ lat: 10.7 }), null);
    assert.equal(normalizeVnCoords(null), null);
  });

  it("PT body carries the rounded fix and a radius; nothing finer than 3 decimals survives", () => {
    const body = buildPtSearchBody({ gpsCoords: { lat: 10.7761234, lng: 106.7019876 }, radiusKm: 20, q: "  yoga ", specialties: ["Yoga"] });
    assert.equal(body.lat, 10.776);
    assert.equal(body.lng, 106.702);
    assert.equal(body.scope, "near");
    assert.equal(body.radiusKm, 20);
    assert.deepEqual(body.filters, { q: "yoga", specialties: ["Yoga"] });
    assert.equal(body.mode, "ANY");
    assert.equal(body.sortBy, "default");
    // only 3-decimal numbers reach the wire
    const wire = JSON.stringify(body);
    assert.ok(!/10\.7761|106\.7019/.test(wire), wire);
  });

  it("an out-of-Vietnam fix is dropped, not sent", () => {
    const body = buildPtSearchBody({ gpsCoords: { lat: 51.5, lng: -0.12 }, provinceCode: 79 });
    assert.equal(body.lat, undefined);
    assert.equal(body.lng, undefined);
    assert.equal(body.scope, "province");
  });

  it("'Toàn quốc' sends neither a fix nor an area, even when a stale fix is still in memory", () => {
    const body = buildPtSearchBody({ national: true, gpsCoords: { lat: 10.7, lng: 106.7 }, provinceCode: 79, wardCode: 1 });
    assert.deepEqual(body, { scope: "national", mode: "ANY", sortBy: "default", limit: 20 });
  });

  it("area only: province → scope 'province' (no radius, no distance); ward → scope 'near' around the ward centre", () => {
    const province = buildPtSearchBody({ provinceCode: 79 });
    assert.equal(province.scope, "province");
    assert.equal(province.areaProvince, 79);
    assert.equal(province.radiusKm, undefined);
    const ward = buildPtSearchBody({ provinceCode: 79, wardCode: 26734, radiusKm: 10 });
    assert.equal(ward.scope, "near");
    assert.equal(ward.areaWard, 26734);
    assert.equal(ward.radiusKm, 10);
    assert.equal(ward.lat, undefined);
  });

  it("a ward without a province is not sent (the server would answer 400)", () => {
    const body = buildPtSearchBody({ wardCode: 26734 });
    assert.equal(body.areaWard, undefined);
    assert.equal(body.scope, "national");
  });

  it("mode, sort, price and limit clamping follow the contract", () => {
    const body = buildPtSearchBody({ mode: "ONLINE", sortBy: "distance", minPrice: 100000, maxPrice: 500000, limit: 500, provinceCode: 1 });
    assert.equal(body.mode, "ONLINE");
    assert.equal(body.sortBy, "distance");
    assert.equal(body.limit, 50);
    assert.deepEqual(body.filters, { minPrice: 100000, maxPrice: 500000 });
  });

  it("gym body mirrors the same rules", () => {
    const body = buildGymSearchBody({ gpsCoords: { lat: 21.0285123, lng: 105.8541987 }, q: "iron", priceMax: 500000, sort: "distance", radiusKm: 50 });
    assert.deepEqual(body, { scope: "near", sort: "distance", limit: 20, lat: 21.029, lng: 105.854, radiusKm: 50, q: "iron", priceMax: 500000 });
    assert.deepEqual(buildGymSearchBody({ national: true }), { scope: "national", sort: "relevance", limit: 20 });
  });

  it("resolveEffectiveScope", () => {
    assert.equal(resolveEffectiveScope({ national: true, hasGps: true, provinceCode: 1 }), "national");
    assert.equal(resolveEffectiveScope({ national: false, hasGps: true }), "near");
    assert.equal(resolveEffectiveScope({ national: false, hasGps: false, provinceCode: 1, wardCode: 2 }), "near");
    assert.equal(resolveEffectiveScope({ national: false, hasGps: false, provinceCode: 1 }), "province");
    assert.equal(resolveEffectiveScope({ national: false, hasGps: false }), "national");
  });

  it("the cursor rides in the body of page 2+, never replacing the filters; page 1 has none", () => {
    const body = buildPtSearchBody({ provinceCode: 79 });
    assert.deepEqual(withCursor(body, null), body);
    assert.deepEqual(withCursor(body, "v1.abc"), { ...body, cursor: "v1.abc" });
    assert.equal((body as any).cursor, undefined, "the original body is not mutated");
  });

  it("the detail request carries area codes only", () => {
    assert.equal(ptDetailParams(null), undefined);
    assert.equal(ptDetailParams({ provinceCode: null, wardCode: 5 }), undefined);
    assert.deepEqual(ptDetailParams({ provinceCode: 79, wardCode: 26734 }), { areaProvince: 79, areaWard: 26734 });
    assert.deepEqual(ptDetailParams({ provinceCode: 79 }), { areaProvince: 79 });
  });
});

describe("only area codes are ever saved", () => {
  it("regionPayload is exactly the two codes (null province = Toàn quốc, which also clears the ward)", () => {
    assert.deepEqual(regionPayload({ provinceCode: 79, wardCode: 26734 }), { searchProvinceCode: 79, searchWardCode: 26734 });
    assert.deepEqual(regionPayload({ provinceCode: null, wardCode: 26734 }), { searchProvinceCode: null, searchWardCode: null });
    assert.deepEqual(regionPayload({ provinceCode: 79, wardCode: null }), { searchProvinceCode: 79, searchWardCode: null });
    assert.deepEqual(Object.keys(regionPayload({ provinceCode: 1, wardCode: 2 })).sort(), ["searchProvinceCode", "searchWardCode"]);
  });
  it("the area summary words the current choice", () => {
    assert.equal(regionSummaryText({ national: true, gpsActive: false, radiusKm: 10 }), "Toàn quốc");
    assert.equal(regionSummaryText({ national: false, gpsActive: true, radiusKm: 20 }), "Vị trí hiện tại (bán kính 20 km)");
    assert.equal(regionSummaryText({ national: false, gpsActive: false, radiusKm: 10, provinceName: "TP. Hồ Chí Minh", wardName: "Phường Tân Định" }), "Phường Tân Định, TP. Hồ Chí Minh");
    assert.equal(regionSummaryText({ national: false, gpsActive: false, radiusKm: 10, provinceName: "Hà Nội" }), "Hà Nội");
  });
});

describe("cursor paging and the 409 reload", () => {
  it("recognises both cursor-drift codes, in either error envelope, and nothing else", () => {
    assert.equal(isCursorResetError(axiosError(409, { error: { code: "CURSOR_EXPIRED" } })), "CURSOR_EXPIRED");
    assert.equal(isCursorResetError(axiosError(409, { code: "CURSOR_FILTER_MISMATCH" })), "CURSOR_FILTER_MISMATCH");
    assert.equal(isCursorResetError(axiosError(409, { code: "PACKAGE_CHANGED" })), null);
    assert.equal(isCursorResetError(axiosError(400, { error: { code: "INVALID_CURSOR" } })), null);
    assert.equal(isCursorResetError(axiosError(503, { code: "QUERY_TIMEOUT" })), null);
    assert.equal(isCursorResetError(new Error("network")), null);
    assert.equal(isCursorResetError(null), null);
    assert.equal(isCursorResetError({ original: axiosError(409, { code: "CURSOR_EXPIRED" }) }), "CURSOR_EXPIRED");
  });

  it("reloads from page 1 on a cursor 409 at page 1 or at 'Xem thêm', but not on any other failure", () => {
    const e409 = axiosError(409, { error: { code: "CURSOR_EXPIRED" } });
    assert.equal(shouldResetCursor(e409, { isError: true, isFetchNextPageError: false }), "CURSOR_EXPIRED");
    assert.equal(shouldResetCursor(e409, { isError: false, isFetchNextPageError: true }), "CURSOR_EXPIRED");
    // a stale error object with no failing state must not trigger a reload loop
    assert.equal(shouldResetCursor(e409, { isError: false, isFetchNextPageError: false }), null);
    assert.equal(shouldResetCursor(axiosError(500, {}), { isError: true, isFetchNextPageError: false }), null);
    assert.equal(shouldResetCursor(null, { isError: true, isFetchNextPageError: false }), null);
  });

  it("next page param: only while hasMore and a real cursor", () => {
    assert.equal(nextCursorParam({ hasMore: true, nextCursor: "v1.x" }), "v1.x");
    assert.equal(nextCursorParam({ hasMore: false, nextCursor: "v1.x" }), undefined);
    assert.equal(nextCursorParam({ hasMore: true, nextCursor: null }), undefined);
    assert.equal(nextCursorParam({ hasMore: true, nextCursor: "" }), undefined);
    assert.equal(nextCursorParam(undefined), undefined);
  });

  it("merging pages keeps the first occurrence, so a row that moved between pages is not duplicated", () => {
    const pages = [{ pts: [{ userId: "a" }, { userId: "b" }] }, { pts: [{ userId: "b" }, { userId: "c" }] }, {}];
    assert.deepEqual(
      mergeUniquePages(pages, (p: any) => p.pts, (pt: any) => pt.userId).map((pt: any) => pt.userId),
      ["a", "b", "c"],
    );
    assert.deepEqual(mergeUniquePages(undefined, () => [], () => ""), []);
  });

  it("query keys are identity-scoped and a reload bumps the key (so the query restarts from page 1)", () => {
    const body = buildPtSearchBody({ provinceCode: 79 });
    assert.notDeepEqual(ptDiscoveryKeys("u1").search(body, 0), ptDiscoveryKeys("u2").search(body, 0));
    assert.notDeepEqual(ptDiscoveryKeys("u1").search(body, 0), ptDiscoveryKeys("u1").search(body, 1));
    assert.deepEqual(ptDiscoveryKeys(null).all, ["pt-discovery", "anon"]);
    assert.deepEqual(gymDiscoveryKeys(null).all, ["gym-discovery", "guest"]);
    assert.equal(ptDiscoveryKeys("u1").profileRegion()[1], "u1");
    assert.notDeepEqual(collabBrandOptionsKey("u1", "", 0), collabBrandOptionsKey("u2", "", 0));
    assert.notDeepEqual(collabBrandOptionsKey("u1", "a", 0), collabBrandOptionsKey("u1", "b", 0));
    assert.notDeepEqual(collabBrandOptionsKey("u1", "a", 0), collabBrandOptionsKey("u1", "a", 1));
  });
});

describe("one-shot GPS reading (only ever run from the button)", () => {
  const ok = { requestPermission: async () => true };

  it("denied permission never reads the position", async () => {
    let read = false;
    const r = await readGpsOnce({
      requestPermission: async () => false,
      getPosition: async () => {
        read = true;
        return { latitude: 10.7, longitude: 106.7 };
      },
    });
    assert.deepEqual(r, { status: "denied" });
    assert.equal(read, false);
  });

  it("a granted fix comes back rounded to 3 decimals — the raw fix never leaves", async () => {
    const r = await readGpsOnce({ ...ok, getPosition: async () => ({ latitude: 10.7761234, longitude: 106.7019876 }) });
    assert.deepEqual(r, { status: "granted", coords: { lat: 10.776, lng: 106.702 } });
  });

  it("a fix outside Vietnam is 'outside', with no coordinates in the result", async () => {
    const r = await readGpsOnce({ ...ok, getPosition: async () => ({ latitude: 37.77, longitude: -122.4 }) });
    assert.deepEqual(r, { status: "outside" });
  });

  it("a position that never arrives times out instead of hanging", async () => {
    const r = await readGpsOnce({ ...ok, timeoutMs: 20, getPosition: () => new Promise(() => undefined) });
    assert.deepEqual(r, { status: "unavailable" });
  });

  it("device errors are 'unavailable', never thrown", async () => {
    assert.deepEqual(
      await readGpsOnce({ requestPermission: async () => { throw new Error("no module"); }, getPosition: async () => null }),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readGpsOnce({ ...ok, getPosition: async () => { throw new Error("location off"); } }),
      { status: "unavailable" },
    );
    assert.deepEqual(await readGpsOnce({ ...ok, getPosition: async () => null }), { status: "unavailable" });
  });

  it("problem copy is Vietnamese and offers the area picker instead", () => {
    assert.match(gpsProblemText("denied") ?? "", /Chưa được cấp quyền vị trí/);
    assert.match(gpsProblemText("unavailable") ?? "", /Chưa bắt được vị trí/);
    assert.match(gpsProblemText("outside") ?? "", /ngoài phạm vi hỗ trợ tại Việt Nam/);
    assert.equal(gpsProblemText("idle"), null);
    assert.equal(gpsProblemText("granted"), null);
    assert.equal(gpsProblemText("locating"), null);
  });
});

describe("brand options (GET /gyms/brand-options)", () => {
  it("drops empty values and clamps the limit", () => {
    assert.deepEqual(brandOptionsParams({}), {});
    assert.deepEqual(brandOptionsParams({ q: "  gym  ", cursor: "c1", limit: 20 }), { q: "gym", cursor: "c1", limit: 20 });
    assert.deepEqual(brandOptionsParams({ q: " ", cursor: null, limit: 999 }), { limit: 50 });
  });
  it("merges the loaded pages, de-duplicated by brandId", () => {
    const pages = [{ options: [{ brandId: "b1" }, { brandId: "branch:g1" }] }, { options: [{ brandId: "b1" }, { brandId: "b2" }] }];
    assert.deepEqual(mergeBrandOptionPages(pages).map((o) => o.brandId), ["b1", "branch:g1", "b2"]);
    assert.deepEqual(mergeBrandOptionPages(undefined), []);
  });
});

describe("membership and gym rows", () => {
  it("a membership names its gym itself (D2 gymName) — no gym directory lookup", () => {
    assert.equal(normalizeMembership({ id: "m1", gymId: "g1", gymName: " Iron District " }).gymName, "Iron District");
    assert.equal(normalizeMembership({ id: "m1", gymId: "g1" }).gymName, null);
  });
  it("a searched gym carries its distance, and only a real number", () => {
    assert.equal(normalizeGym({ id: "g", name: "A", distanceKm: 1.2 }).distanceKm, 1.2);
    assert.equal(normalizeGym({ id: "g", name: "A", distanceKm: null }).distanceKm, null);
    assert.equal(normalizeGym({ id: "g", name: "A", distanceKm: "1.2" }).distanceKm, null);
    assert.equal(normalizeGym({ id: "g", name: "A" }).distanceKm, null);
  });
});

describe("X-Gymini-Client", () => {
  it("is mobile/<version>/<build> on every request (not only the listing-flow routes)", () => {
    const h = clientIdentityHeaders({ version: "1.4.2", build: 57 });
    assert.deepEqual(h, { [CLIENT_HEADER]: "mobile/1.4.2/57" });
    assert.equal(CLIENT_HEADER, "X-Gymini-Client");
  });
  it("falls back to 0 for a missing version/build and stays within the server's 120-char limit", () => {
    assert.equal(clientIdentityHeaders({ version: null, build: undefined })[CLIENT_HEADER], "mobile/0/0");
    assert.ok(clientHeaderValue("x".repeat(300), 1).length <= 120);
  });
  it("the listing-flow header set is unchanged (still compat routes only)", () => {
    assert.equal(listingFlowHeaders("get", "/gyms", { version: "1", build: 1 }), null);
    assert.ok(listingFlowHeaders("put", "/owner/application/amenities", { version: "1", build: 1 }));
  });
});

describe("photo attribution", () => {
  it("shows the generic line when the API exposes no photographer, 'Ảnh: Pexels / <tác giả>' when it does", () => {
    assert.equal(photoAttributionLine(), PHOTO_ATTRIBUTION_TEXT);
    assert.equal(photoAttributionLine("  "), PHOTO_ATTRIBUTION_TEXT);
    assert.equal(photoAttributionLine("Jane Doe"), "Ảnh: Pexels / Jane Doe");
    assert.equal(PHOTO_ATTRIBUTION_LINK, "Nguồn ảnh & giấy phép");
  });
});
