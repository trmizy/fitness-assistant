/**
 * Pure-function tests (no database) for the "distance from the client" part of GET /contracts/gym-options:
 * Haversine + rounding + null rules (contract-gym-distance.ts) and the nearest-first ordering with the old
 * plan P3.4 order as tie-break (compareGymOptions).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gymDistanceKm, sortByDistanceNullsLast } from "../services/contract-gym-distance";
import { compareGymOptions, type GymOption } from "../services/contract-gym-options.service";

// Phuong Ben Nghe (Q1) centre vs a Go Vap pin: ~7-8 km straight line.
const BEN_NGHE = { lat: 10.7769, lng: 106.7009 };
const GO_VAP = { latitude: 10.8386, longitude: 106.6652 };

test("gymDistanceKm: 0.1 km rounding, symmetric, zero for same point", () => {
  const d = gymDistanceKm(BEN_NGHE, GO_VAP);
  assert.ok(d !== null && d > 7 && d < 8.5, `got ${d}`);
  assert.equal(Math.round(d! * 10) / 10, d);
  assert.equal(gymDistanceKm({ lat: 10, lng: 106 }, { latitude: 10, longitude: 106 }), 0);
  // 1 degree of latitude ~ 111.2 km with R=6371.0088
  assert.equal(gymDistanceKm({ lat: 10, lng: 106 }, { latitude: 11, longitude: 106 }), 111.2);
});

test("gymDistanceKm: no reference / no pin / garbage / outside Vietnam -> null", () => {
  assert.equal(gymDistanceKm(null, GO_VAP), null);
  assert.equal(gymDistanceKm({ lat: null, lng: null }, GO_VAP), null);
  assert.equal(gymDistanceKm(BEN_NGHE, { latitude: null, longitude: null }), null);
  assert.equal(gymDistanceKm(BEN_NGHE, {}), null);
  assert.equal(gymDistanceKm(BEN_NGHE, { latitude: NaN, longitude: 106 }), null);
  assert.equal(gymDistanceKm(BEN_NGHE, { latitude: 40, longitude: -74 }), null);
});

const opt = (gymId: string, name: string, distanceKm: number | null, extra: Partial<GymOption> = {}): GymOption =>
  ({
    gymId, name, city: null, brandId: "b", isPtTrainingLocation: false, distanceKm,
    membership: { hasActiveMembership: false, membershipId: null, planName: null, endDate: null, purchasedHere: false },
    eligibility: {} as any,
    ...extra,
  }) as GymOption;

test("sortByDistanceNullsLast: nearest first, nulls last, ties fall back to the old order", () => {
  const list = [
    opt("a", "Q7", 12.3),
    opt("b", "No pin", null),
    opt("c", "Go Vap", 3.1),
    opt("d", "Another Go Vap", 3.1),
    opt("e", "Also no pin", null, { isPtTrainingLocation: true }),
  ];
  const out = sortByDistanceNullsLast([...list].sort(compareGymOptions), compareGymOptions).map((g) => g.gymId);
  // 3.1 tie: "Another Go Vap" < "Go Vap" by name; unknowns last, PT training location first among them.
  assert.deepEqual(out, ["d", "c", "a", "e", "b"]);
});

test("sortByDistanceNullsLast: no distance anywhere keeps the input order untouched", () => {
  const list = [opt("z", "Zeta", null, { isPtTrainingLocation: true }), opt("a", "Alpha", null)];
  assert.equal(sortByDistanceNullsLast(list, compareGymOptions), list);
});
