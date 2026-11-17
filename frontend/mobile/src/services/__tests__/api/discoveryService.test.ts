/**
 * U2 — service/API tests for discovery: the wire shape of the location-aware searches and the client header.
 *
 * TEST FIXTURE level (real `api` instance and interceptors, stubbed adapter): what these pin down is the privacy
 * contract of plan v2.2.5 — a GPS fix goes out ONLY in a POST body, rounded to 3 decimals, never in the URL or the
 * query string — and that every request, not only the listing-flow routes, carries `X-Gymini-Client`.
 */
import { gymService, profileService } from "../../api";
import { buildGymSearchBody, buildPtSearchBody, ptDetailParams, withCursor } from "../../../features/services/discoverySearch";
import { stubHttp, type HttpStub } from "./httpStub";

let http: HttpStub;

afterEach(() => http?.restore());

const RAW_LAT = 10.7761234;
const RAW_LNG = 106.7019876;

describe("POST /profile/pts/search", () => {
  it("sends the rounded GPS fix in the body only — the URL and the query string carry no coordinate", async () => {
    http = stubHttp(() => ({ data: { pts: [], nextCursor: null, hasMore: false, appliedScope: "near" } }));
    const body = buildPtSearchBody({ gpsCoords: { lat: RAW_LAT, lng: RAW_LNG }, radiusKm: 10 });

    await profileService.searchPTs(body);

    const call = http.last();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/profile/pts/search");
    expect(call.url).toBe("/profile/pts/search");
    expect(call.query).toEqual({});
    expect(call.params).toBeUndefined();
    expect(call.body.lat).toBe(10.776);
    expect(call.body.lng).toBe(106.702);
    expect(JSON.stringify(call.body)).not.toMatch(/10\.7761|106\.7019/);
    expect(call.url).not.toMatch(/10\.7|106\.7|lat|lng/);
  });

  it("page 2 repeats the same body plus the cursor, still without coordinates in the URL", async () => {
    http = stubHttp(() => ({ data: { pts: [], nextCursor: null, hasMore: false, appliedScope: "near" } }));
    const body = buildPtSearchBody({ gpsCoords: { lat: RAW_LAT, lng: RAW_LNG } });

    await profileService.searchPTs(withCursor(body, "v1.opaque"));

    expect(http.last().url).toBe("/profile/pts/search");
    expect(http.last().body.cursor).toBe("v1.opaque");
    expect(http.last().body.lat).toBe(10.776);
  });

  it("a 409 CURSOR_EXPIRED reaches the caller as a rejected request (the screen then reloads from page 1)", async () => {
    http = stubHttp(() => ({ status: 409, data: { error: { code: "CURSOR_EXPIRED" } } }));
    await expect(profileService.searchPTs(withCursor(buildPtSearchBody({}), "old"))).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});

describe("POST /gyms/search", () => {
  it("also keeps the fix in the body (rounded) and off the URL", async () => {
    http = stubHttp(() => ({ data: { success: true, data: { gyms: [], nextCursor: null, hasMore: false, appliedScope: "near" } } }));

    const result = await gymService.searchGyms(buildGymSearchBody({ gpsCoords: { lat: RAW_LAT, lng: RAW_LNG }, sort: "distance" }));

    const call = http.last();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("/gyms/search");
    expect(call.params).toBeUndefined();
    expect(call.body).toMatchObject({ lat: 10.776, lng: 106.702, scope: "near", sort: "distance" });
    expect(result).toEqual({ gyms: [], nextCursor: null, hasMore: false, appliedScope: "near" });
  });
});

describe("GET /gyms/brand-options", () => {
  it("passes q / cursor / limit as query params and unwraps { success, data }", async () => {
    http = stubHttp(() => ({ data: { success: true, data: { options: [{ scope: "BRAND", brandId: "b1" }], nextCursor: "c2", hasMore: true } } }));

    const page = await gymService.getBrandOptions({ q: "iron", cursor: "c1", limit: 20 });

    expect(http.last().method).toBe("GET");
    expect(http.last().path).toBe("/gyms/brand-options");
    expect(http.last().params).toEqual({ q: "iron", cursor: "c1", limit: 20 });
    expect(page.hasMore).toBe(true);
    expect(page.options[0].brandId).toBe("b1");
  });

  it("drops empty params", async () => {
    http = stubHttp(() => ({ data: { options: [], nextCursor: null, hasMore: false } }));
    await gymService.getBrandOptions({ q: "", cursor: null });
    expect(http.last().params).toEqual({});
  });
});

describe("GET /profile/pts/:id", () => {
  it("loads one trainer by id (no list), with area codes only as params", async () => {
    http = stubHttp(() => ({ data: { userId: "pt-1", firstName: "Minh" } }));

    await profileService.getPTDetail("pt-1", { areaProvince: 79, areaWard: 26734 });
    expect(http.last().path).toBe("/profile/pts/pt-1");
    expect(http.last().params).toEqual({ areaProvince: 79, areaWard: 26734 });

    await profileService.getPTDetail("pt-1");
    expect(http.last().params).toBeUndefined();

    expect(ptDetailParams({ provinceCode: 79 })).toEqual({ areaProvince: 79 });
  });

  it("a hidden trainer answers 404 to the caller (the screen shows its gentle empty state)", async () => {
    http = stubHttp(() => ({ status: 404, data: { error: "Not found" } }));
    await expect(profileService.getPTDetail("gone")).rejects.toMatchObject({ response: { status: 404 } });
    expect(http.calls.every((c) => c.path === "/profile/pts/gone")).toBe(true);
  });
});

describe("X-Gymini-Client", () => {
  it("is on every request — a plain GET, a POST search and a PUT — as mobile/<version>/<build>", async () => {
    http = stubHttp(() => ({ data: {} }));

    await profileService.getProfile();
    await profileService.searchPTs(buildPtSearchBody({}));
    await profileService.updateProfile({ searchProvinceCode: 79, searchWardCode: null });

    expect(http.calls).toHaveLength(3);
    for (const call of http.calls) {
      expect(call.headers["X-Gymini-Client"]).toMatch(/^mobile\/[^/]+\/[^/]+$/);
    }
  });

  it("saving the search area sends the two area codes and nothing else (no coordinates)", async () => {
    http = stubHttp(() => ({ data: { profile: {} } }));
    await profileService.updateProfile({ searchProvinceCode: null, searchWardCode: null });
    expect(http.last().method).toBe("PUT");
    expect(http.last().path).toBe("/profile/me");
    expect(Object.keys(http.last().body).sort()).toEqual(["searchProvinceCode", "searchWardCode"]);
  });
});
