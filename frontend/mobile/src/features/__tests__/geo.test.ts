/** N15M-13 - Chạy: npx tsx --test src/features/__tests__/geo.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isInVietnam } from "../../utils/geo";
import { directionsUrl, normalizeGym } from "../services/gymDirectory";

describe("isInVietnam", () => {
  it("accepts mainland and island points", () => {
    assert.equal(isInVietnam(10.8176, 106.6822), true, "TP.HCM");
    assert.equal(isInVietnam(21.0285, 105.8542), true, "Hà Nội");
    assert.equal(isInVietnam(8.6, 104.72), true, "Cà Mau");
    assert.equal(isInVietnam(8.65, 111.92), true, "Trường Sa");
    assert.equal(isInVietnam(16.5, 112.3), true, "Hoàng Sa");
    assert.equal(isInVietnam(23.4, 105.3), true, "Lũng Cú");
  });
  it("rejects swapped, zero, foreign and non-number values", () => {
    assert.equal(isInVietnam(106.6822, 10.8176), false, "lat/lng swapped");
    assert.equal(isInVietnam(0, 0), false);
    assert.equal(isInVietnam(48.85, 2.35), false, "Paris");
    assert.equal(isInVietnam(10.8, 125), false);
    assert.equal(isInVietnam(null, 106), false);
    assert.equal(isInVietnam("10.8", "106.6"), false);
    assert.equal(isInVietnam(NaN, 106), false);
  });
  it("directions are not offered for a pin outside Vietnam, but are for a good one", () => {
    assert.equal(directionsUrl({ latitude: 106.6, longitude: 10.8 }), null);
    assert.equal(directionsUrl({ latitude: 10.8, longitude: 106.6 }), "https://www.google.com/maps/dir/?api=1&destination=10.8,106.6");
    assert.equal(directionsUrl({ latitude: null, longitude: null }), null);
  });
});
