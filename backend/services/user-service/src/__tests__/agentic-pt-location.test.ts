/**
 * AI Coach PT search location support (agentic-pt-location.ts + scorePT proximity). Pure-function tests — no database: place text
 * normalisation, nearest-location-per-PT selection, and how distance/overlap change the ranking the service returns
 * (it ranks with the shared scorePT). The SQL (ward/district resolution, haversine) is covered by agentic-fitness-location.test.ts
 * which needs a *_test database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scorePT, type AgentPreferences, type PTCandidate } from "@gym-coach/shared";
import { normalizePlaceText, pickNearestPerPt, stripAdminPrefix } from "../services/agentic-pt-location";

test("normalizePlaceText / stripAdminPrefix: accents, đ, admin prefixes", () => {
  assert.equal(normalizePlaceText("Quận Gò Vấp"), "quan go vap");
  assert.equal(normalizePlaceText("Phường  Đa Kao!"), "phuong da kao");
  assert.equal(stripAdminPrefix("quan go vap"), "go vap");
  assert.equal(stripAdminPrefix("thanh pho ho chi minh"), "ho chi minh");
  assert.equal(stripAdminPrefix("quan 7"), "7");
  assert.equal(stripAdminPrefix("go vap"), "go vap");
  assert.equal(stripAdminPrefix("phuong"), "phuong"); // a bare prefix word is not stripped to nothing
});

test("pickNearestPerPt: smallest known distance wins; unknown distance loses to a known one; first row wins with none", () => {
  const m = pickNearestPerPt([
    { ptUserId: "a", provinceCode: 79, label: "Quận 9", distanceKm: 12.3 },
    { ptUserId: "a", provinceCode: 79, label: "Gò Vấp", distanceKm: 1.2 },
    { ptUserId: "a", provinceCode: 1, label: "Hà Nội", distanceKm: null },
    { ptUserId: "b", provinceCode: 1, label: "Cầu Giấy", distanceKm: null },
    { ptUserId: "b", provinceCode: 1, label: "Đống Đa", distanceKm: null },
    { ptUserId: "c", provinceCode: 48, label: "Hải Châu", distanceKm: null },
    { ptUserId: "c", provinceCode: 48, label: "Sơn Trà", distanceKm: 3 },
  ]);
  assert.deepEqual(m.get("a")!.nearest, { label: "Gò Vấp", distanceKm: 1.2, provinceCode: 79 });
  assert.deepEqual(m.get("a")!.provinceCodes.sort(), [1, 79]);
  assert.deepEqual(m.get("b")!.nearest, { label: "Cầu Giấy", distanceKm: null, provinceCode: 1 });
  assert.deepEqual(m.get("c")!.nearest, { label: "Sơn Trà", distanceKm: 3, provinceCode: 48 });
});

const cand = (id: string, over: Partial<PTCandidate> = {}): PTCandidate => ({
  id, name: id, photoUrl: null, specialties: ["Giảm mỡ"], yearsExperience: null, languages: [], certificates: [],
  packages: [{ id: `${id}-p`, name: "p", price: 1_000_000, sessions: 8, sessionMinutes: 60, mode: "OFFLINE" }],
  availableDays: [1, 3, 5], availableSlots: 20, averageRating: null, reviewCount: 0, clientsStarted: 0, clientsCompleted: 0,
  cancellationRate: null, noShowRate: null, dataOrigin: "REAL",
  history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null, medianDurationWeeks: null, completionRate: null,
    dataOrigin: "REAL", similarityVersion: "x", note: "" }, ...over,
});
const prefs: AgentPreferences = { goal: "WEIGHT_LOSS", days: [1, 3, 5], budgetVnd: 2_000_000, demo: false };
// The exact ordering agenticFitnessService.candidates() applies: score desc, id asc.
const rank = (list: PTCandidate[], p: Parameters<typeof scorePT>[1] = prefs) =>
  list.map(c => ({ id: c.id, total: scorePT(c, p).total })).sort((x, y) => y.total - x.total || x.id.localeCompare(y.id)).map(x => x.id);

test("ranking: a near PT beats a far PT; partial day overlap is soft (ranked lower, not dropped)", () => {
  const list = [
    cand("far", { location: { label: "Quận 9", distanceKm: 28 } }),
    cand("near", { location: { label: "Gò Vấp", distanceKm: 1.5 } }),
    cand("near-partial", { location: { label: "Gò Vấp", distanceKm: 1.5 }, availableDays: [1] }),
  ];
  const order = rank(list);
  assert.equal(order[0], "near");
  assert.ok(order.includes("near-partial"), "a PT free on only 1 of 3 requested days is still returned");
  assert.ok(scorePT(list[2], prefs).total < scorePT(list[1], prefs).total);
});

test("ranking: ONLINE ignores distance; unknown distance is neutral", () => {
  const list = [cand("b", { location: { label: "x", distanceKm: 29 } }), cand("a", { location: { label: "y", distanceKm: 1 } })];
  assert.deepEqual(rank(list, { ...prefs, mode: "ONLINE" }), ["a", "b"]); // equal scores -> id order, distance not used
  assert.equal(scorePT(cand("n", { location: { label: "z", distanceKm: null } }), prefs).total, scorePT(cand("n"), prefs).total);
});
