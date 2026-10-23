/**
 * Listing Management D2 - the client side of a public gym row: amenities with the `facilities` fallback, cover and gallery
 * URLs, hidden-gym (404) handling. CODE/UNIT only.
 * Run: npx tsx --test src/app/utils/__tests__/gymPublic.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardAmenityChips, coverUrlOf, galleryPhotosOf, groupedPublicAmenities, isPublicGymGone, publicAmenitiesOf } from "../gymPublic";

const A = (slug: string, name: string, category = "FACILITY", iconKey = "wifi") => ({ slug, name, category, iconKey });

describe("publicAmenitiesOf", () => {
  it("reads amenities[] (slug, name, category, iconKey) in the server's order", () => {
    const list = publicAmenitiesOf({ amenities: [A("WIFI", "Wifi miễn phí"), A("custom-spa-1", "Spa", "RECOVERY", "sparkles")] });
    assert.deepEqual(list.map((a) => a.name), ["Wifi miễn phí", "Spa"]);
    assert.equal(list[1].category, "RECOVERY");
    assert.equal(list[1].iconKey, "sparkles");
  });

  it("an explicit empty amenities[] is authoritative (no fallback to the stale mirror)", () => {
    assert.deepEqual(publicAmenitiesOf({ amenities: [], facilities: ["WIFI"] }), []);
  });

  it("without amenities[] it falls back to the legacy facilities, mapped to the catalogue's name / category / icon", () => {
    const list = publicAmenitiesOf({ facilities: ["SAUNA", "WIFI", "SOMETHING_NEW"] });
    assert.deepEqual(list.map((a) => a.name), ["Xông hơi", "Wifi miễn phí", "SOMETHING_NEW"]);
    assert.equal(list[0].category, "RECOVERY");
    assert.equal(list[0].iconKey, "flame");
    assert.equal(list[2].category, "FACILITY", "an unknown value is kept, never dropped");
  });

  it("garbage in -> empty list, never a crash", () => {
    assert.deepEqual(publicAmenitiesOf(null), []);
    assert.deepEqual(publicAmenitiesOf({}), []);
    assert.deepEqual(publicAmenitiesOf({ amenities: [null, { name: " " }, { name: 5 }, { slug: "x", name: "Ok", category: "NOPE" }] }).map((a) => [a.name, a.category]), [["Ok", "FACILITY"]]);
  });
});

describe("result card chips", () => {
  const gym = { amenities: ["a", "b", "c", "d", "e", "f"].map((s) => A(s, `Tiện ích ${s}`)) };
  it("shows up to 4 chips and counts the rest", () => {
    const { chips, extra } = cardAmenityChips(gym, 4);
    assert.equal(chips.length, 4);
    assert.equal(extra, 2);
  });
  it("fewer than 4 -> no '+N'; none -> no chips", () => {
    assert.deepEqual(cardAmenityChips({ amenities: [A("a", "A")] }, 4).extra, 0);
    assert.equal(cardAmenityChips({}, 4).chips.length, 0);
  });
  it("the fallback feeds the chips too", () => {
    assert.equal(cardAmenityChips({ facilities: ["WIFI", "SAUNA", "PARKING", "SHOWER", "KIDS_AREA"] }, 4).extra, 1);
  });
});

describe("detail view grouping", () => {
  it("groups under the four category names in a fixed order", () => {
    const groups = groupedPublicAmenities({ amenities: [A("s", "Xông hơi", "RECOVERY"), A("w", "Wifi", "FACILITY"), A("t", "Tạ", "TRAINING_ZONE"), A("g", "Lớp nhóm", "SERVICE")] });
    assert.deepEqual(groups.map((g) => g.category), ["FACILITY", "TRAINING_ZONE", "SERVICE", "RECOVERY"]);
  });
});

describe("photo URLs (stable /media links, never the owner's presigned ones)", () => {
  it("cover: coverPhotoUrl first, else the detail's cover, else the first photo, else null", () => {
    assert.equal(coverUrlOf({ coverPhotoUrl: "/media/gym-photos/c1" }, "/api"), "/api/media/gym-photos/c1");
    assert.equal(coverUrlOf({ photos: [{ id: "a", url: "/media/gym-photos/a" }, { id: "b", url: "/media/gym-photos/b", isCover: true }] }, "/api"), "/api/media/gym-photos/b");
    assert.equal(coverUrlOf({ photos: [{ id: "a", url: "/media/gym-photos/a" }] }, "/api/"), "/api/media/gym-photos/a");
    assert.equal(coverUrlOf({}, "/api"), null);
    assert.equal(coverUrlOf({ coverPhotoUrl: null }, "/api"), null);
  });
  it("an absolute API base and an absolute photo URL both work", () => {
    assert.equal(coverUrlOf({ coverPhotoUrl: "/media/gym-photos/c" }, "https://api.gymini.vn"), "https://api.gymini.vn/media/gym-photos/c");
    assert.equal(coverUrlOf({ coverPhotoUrl: "https://cdn/x.webp" }, "/api"), "https://cdn/x.webp");
  });
  it("the gallery resolves every URL and keeps category / cover flags", () => {
    const g = galleryPhotosOf({ photos: [{ id: "a", url: "/media/gym-photos/a", category: "OTHER", isCover: true }, { id: "b", url: null }, { nope: 1 }] }, "/api");
    assert.equal(g.length, 2);
    assert.equal(g[0].url, "/api/media/gym-photos/a");
    assert.equal(g[0].isCover, true);
    assert.equal(g[1].url, null);
  });
});

describe("hidden gym", () => {
  it("404 on the gym / plans / reviews is a 'gone' state, other failures are not", () => {
    assert.equal(isPublicGymGone({ response: { status: 404, data: { error: { code: "GYM_NOT_FOUND" } } } }), true);
    assert.equal(isPublicGymGone({ response: { status: 500, data: {} } }), false);
    assert.equal(isPublicGymGone(new Error("network")), false);
  });
});
