/**
 * AI Coach PT search, owner complaint (REAL DEVICE): "Tìm PT giảm mỡ, 5 triệu" still asked the budget, and there was no location
 * awareness. Oracle: hand-labelled expected values. Pure functions only (no DB): the budget/mode/place parser, the FIND_PT
 * opening-message extractor, the slot resolution that decides what is still asked, and the proximity term of scorePT.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FITNESS_SCORING, proximityScore, scorePT, type AgentPreferences, type PTCandidate } from "@gym-coach/shared";
import { parseConstraintPhrase, parseFitnessAgentIntent, parsePlacePhrase } from "../services/fitness-agent-intent";
import { findPtWorkflow } from "../agent-workflow/workflows/find-pt-program.workflow";
import { missingRequiredSlots } from "../agent-workflow/slot-resolver";

const budget = (t: string) => parseConstraintPhrase(t).budgetVnd;

const BUDGETS: Array<[string, number]> = [
  ["Tìm PT giảm mỡ, 5 triệu", 5_000_000],
  ["tim pt giam mo 2 trieu", 2_000_000],
  ["PT giá 5tr thôi", 5_000_000],
  ["2,5 triệu một tháng", 2_500_000],
  ["ngân sách 2.5 triệu", 2_500_000],
  ["tối đa 500k", 500_000],
  ["500 nghìn", 500_000],
  ["khoảng 1.5m", 1_500_000],
  ["dưới 3 triệu", 3_000_000], // prefix form still works
  ["budget 4tr", 4_000_000],
  ["1tr5", 1_500_000], // spoken shorthand
  ["dưới 1.500.000", 1_500_000], // thousands grouping (used to read as 1.5 -> 2 VND)
];
for (const [text, expected] of BUDGETS) test(`budget "${text}" -> ${expected}`, () => assert.equal(budget(text), expected));

const NOT_BUDGETS = [
  "Tôi nặng 70 kg, muốn giảm 5kg",
  "mỗi buổi 60 phút",
  "tập 5 buổi một tuần",
  "khoảng 60 phút mỗi buổi", // a prefix word followed by minutes is not money
  "cao 1m70",
  "tôi 25 tuổi",
  "thứ 2 và thứ 5",
];
for (const text of NOT_BUDGETS) test(`no budget read from "${text}"`, () => assert.equal(budget(text), undefined));

test("mode: online / offline phrases", () => {
  assert.equal(parseConstraintPhrase("tôi muốn tập online").mode, "ONLINE");
  assert.equal(parseConstraintPhrase("tập trực tuyến thôi").mode, "ONLINE");
  for (const t of ["tập tại phòng gym", "tập ở gym", "tập tại gym", "tìm PT gần nhà", "tìm PT gần tôi", "tập trực tiếp"]) {
    assert.equal(parseConstraintPhrase(t).mode, "OFFLINE", t);
  }
  assert.equal(parseConstraintPhrase("tìm PT giảm mỡ").mode, undefined);
});

const PLACES: Array<[string, string]> = [
  ["Tìm PT giảm mỡ ở Gò Vấp", "go vap"],
  ["tìm pt gần Thủ Đức, 3 triệu", "thu duc"],
  ["Tìm PT tại quận 7 giúp tôi", "quan 7"],
  ["tìm PT ở Hà Nội để tập trực tiếp", "ha noi"],
  ["tìm pt ở khu vực Tân Bình", "tan binh"],
  ["PT ở TPHCM", "ho chi minh"],
];
for (const [text, expected] of PLACES) test(`place "${text}" -> ${expected}`, () => assert.equal(parsePlacePhrase(text), expected));

const NOT_PLACES = ["Tìm PT tập ở nhà", "tập ở gym", "tìm PT gần nhà", "tại phòng gym", "tại sao tôi cần PT", "PT ở đâu tốt", "tìm PT giảm mỡ"];
for (const text of NOT_PLACES) test(`no place read from "${text}"`, () => assert.equal(parsePlacePhrase(text), undefined));

test("PT intent carries budget, mode and place; a non-PT message never gets a place", () => {
  const intent = parseFitnessAgentIntent("Tìm PT giảm mỡ ở Gò Vấp, 5 triệu, tập trực tiếp");
  assert.equal(intent.kind, "PT");
  assert.deepEqual(intent.preferences, { goal: "WEIGHT_LOSS", budgetVnd: 5_000_000, mode: "OFFLINE", placeText: "go vap" });
  assert.equal(parseFitnessAgentIntent("Gợi ý chương trình tập ở Gò Vấp").preferences.placeText, undefined);
});

// ---- the workflow that asks the missing slots picks the values up from the FIRST message ---------------------------------------
const extract = (m: string) => (findPtWorkflow as any).extractFromMessage(m) as Record<string, unknown>;
const ctxWith = (known: Record<string, unknown>, profile: Record<string, unknown> = {}) => ({
  userId: "u", sessionId: "s", enterpriseContext: { profile: { goal: null, days: [], sessionMinutes: 60, budgetVnd: null, ...profile }, coach: {} }, known,
}) as any;

test("FIND_PT opening message 'Tìm PT giảm mỡ, 5 triệu' fills goal+budget — the budget is NOT asked again, only the days are", () => {
  const known = extract("Tìm PT giảm mỡ, 5 triệu");
  assert.deepEqual(known, { goal: "WEIGHT_LOSS", budgetVnd: 5_000_000 });
  const missing = missingRequiredSlots(findPtWorkflow.slots, ctxWith(known)).map((s) => s.key);
  assert.deepEqual(missing, ["days"]);
});

test("FIND_PT: the device sentence with '2 triệu' in the first message is not re-asked", () => {
  const known = extract("Tôi muốn tìm PT giảm mỡ, ngân sách 2 triệu, tập T2 T4 T6");
  assert.equal(known.budgetVnd, 2_000_000);
  assert.deepEqual(known.days, [1, 3, 5]);
  assert.deepEqual(missingRequiredSlots(findPtWorkflow.slots, ctxWith(known)), []);
});

test("FIND_PT: place + mode in the opening message are carried as optional slots (never asked)", () => {
  const known = extract("Tìm PT giảm mỡ ở Gò Vấp, tập trực tiếp");
  assert.equal(known.placeText, "go vap");
  assert.equal(known.mode, "OFFLINE");
  assert.ok(!missingRequiredSlots(findPtWorkflow.slots, ctxWith(known)).some((s) => s.key === "placeText" || s.key === "mode"));
  assert.deepEqual(extract("Tìm PT cho tôi"), {});
});

// ---- proximity term of scorePT ---------------------------------------------------------------------------------------------------
const pt = (over: Partial<PTCandidate> = {}): PTCandidate => ({
  id: "pt", name: "PT", photoUrl: null, specialties: ["Giảm mỡ"], yearsExperience: null, languages: [], certificates: [],
  packages: [{ id: "p", name: "p", price: 1_000_000, sessions: 8, sessionMinutes: 60, mode: "OFFLINE" }],
  availableDays: [1, 3, 5], availableSlots: 20, averageRating: null, reviewCount: 0, clientsStarted: 0, clientsCompleted: 0,
  cancellationRate: null, noShowRate: null, dataOrigin: "REAL",
  history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null, medianDurationWeeks: null, completionRate: null,
    dataOrigin: "REAL", similarityVersion: "x", note: "" }, ...over,
});
const prefs: AgentPreferences = { goal: "WEIGHT_LOSS", days: [1, 3, 5], budgetVnd: 2_000_000, demo: false };

test("proximityScore: full within 5 km, linear decay, zero at 30 km", () => {
  assert.equal(proximityScore(0), 1);
  assert.equal(proximityScore(5), 1);
  assert.equal(proximityScore(17.5), 0.5);
  assert.equal(proximityScore(30), 0);
  assert.equal(proximityScore(80), 0);
  assert.equal(FITNESS_SCORING.weights.proximity, 15);
});

test("scorePT: a nearer PT outranks a farther one; no distance / ONLINE leaves the score exactly as before", () => {
  const near = scorePT(pt({ location: { label: "Gò Vấp", distanceKm: 2 } }), { ...prefs });
  const far = scorePT(pt({ location: { label: "Quận 9", distanceKm: 25 } }), { ...prefs });
  assert.ok(near.total > far.total, `${near.total} > ${far.total}`);
  assert.equal(near.components.proximity, 1);
  const none = scorePT(pt(), { ...prefs });
  assert.equal(none.components.proximity, undefined);
  assert.equal(scorePT(pt({ location: { label: "x", distanceKm: null } }), { ...prefs }).total, none.total);
  assert.equal(scorePT(pt({ location: { label: "x", distanceKm: 40 } }), { ...prefs, mode: "ONLINE" }).total, scorePT(pt(), { ...prefs, mode: "ONLINE" }).total);
});

test("scorePT: partial schedule overlap scores lower than a full overlap", () => {
  const full = scorePT(pt(), { ...prefs });
  const partial = scorePT(pt({ availableDays: [1] }), { ...prefs });
  assert.equal(partial.components.schedule, 1 / 3);
  assert.ok(partial.total < full.total);
});
