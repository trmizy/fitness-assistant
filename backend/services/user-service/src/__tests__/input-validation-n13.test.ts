import test from "node:test";
import assert from "node:assert/strict";
import { parseInBodyInput, assertInBodyConsistent } from "../services/inbody.validation";
import { hasReadableInBodyMetrics } from "../services/inbody.service";
import { profileSchema } from "../models/profile.models";
import { parseNotificationPaging } from "../controllers/notification.controller";

/**
 * N13G-01/02/03/06, N13A-04, N13A-08 - input validation. TEST FIXTURE: pure functions, no database, no network.
 */

const NOW = new Date("2026-11-14T10:00:00.000Z");
const good = { date: "2026-11-10T00:00:00.000Z", weight: 70, muscleMass: 30, bodyFat: 12 };

function refuses(raw: unknown, mode: "create" | "patch", field: string, messageRe?: RegExp) {
  assert.throws(
    () => parseInBodyInput(raw, mode, NOW),
    (e: any) => {
      assert.equal(e.status, 400);
      assert.equal(e.code, "INBODY_INVALID_INPUT");
      assert.equal(e.field, field);
      assert.match(e.message, messageRe ?? /[À-ỹ]/, "Vietnamese message");
      return true;
    },
  );
}

test("InBody whitelist: userId / id / createdAt / dateOnly / unknown keys never survive parsing", () => {
  const out = parseInBodyInput(
    { ...good, userId: "victim", id: "x", createdAt: "2000-01-01", updatedAt: "2000-01-01", dateOnly: "2000-01-01", isAdmin: true, __proto__: { a: 1 } },
    "create",
    NOW,
  ) as Record<string, unknown>;
  for (const k of ["userId", "id", "createdAt", "updatedAt", "dateOnly", "isAdmin"]) assert.equal(k in out, false, k);
  assert.deepEqual(Object.keys(out).sort(), ["bodyFat", "date", "muscleMass", "weight"]);
  assert.ok(out.date instanceof Date);
});

test("InBody patch whitelist: only measurement fields come through", () => {
  const out = parseInBodyInput({ weight: 71, userId: "victim", id: "z", createdAt: "1999-01-01" }, "patch", NOW);
  assert.deepEqual(out, { weight: 71 });
});

test("InBody ranges - weight 20..400", () => {
  for (const w of [-5, 0, 19.9, 400.1, 9999]) refuses({ ...good, weight: w }, "create", "weight", /Cân nặng phải từ 20 đến 400/);
  for (const w of [20, 400]) assert.doesNotThrow(() => parseInBodyInput({ ...good, weight: w, muscleMass: 10, bodyFat: 5 }, "create", NOW));
});

test("InBody ranges - height 100..250, body fat % 2..75, BMR 500..5000 (integer), visceral 1..60", () => {
  for (const h of [0, 99, 251, 500]) refuses({ ...good, height: h }, "create", "height", /Chiều cao phải từ 100 đến 250/);
  for (const p of [1, 76, 150]) refuses({ ...good, bodyFatPct: p }, "create", "bodyFatPct");
  for (const b of [499, 5001, 99999]) refuses({ ...good, bmr: b }, "create", "bmr");
  refuses({ ...good, bmr: 1500.5 }, "create", "bmr", /số nguyên/);
  for (const v of [0, 61]) refuses({ ...good, visceralFat: v }, "create", "visceralFat");
  assert.doesNotThrow(() =>
    parseInBodyInput({ ...good, height: 175, bodyFatPct: 17, bmr: 1650, visceralFat: 8 }, "create", NOW),
  );
});

test("InBody types: string / object / boolean / NaN-as-null are 400, never thrown as a raw error", () => {
  refuses({ ...good, weight: "abc" }, "create", "weight", /phải là một số/);
  refuses({ ...good, weight: { a: 1 } }, "create", "weight");
  refuses({ ...good, muscleMass: true }, "create", "muscleMass");
  refuses({ ...good, notes: 5 }, "create", "notes");
  refuses({ ...good, status: "hacked" }, "create", "status");
  refuses({ ...good, date: "abc" }, "create", "date", /Ngày đo không hợp lệ/);
  refuses({ ...good, date: 12345 }, "create", "date");
  assert.throws(() => parseInBodyInput(null, "create", NOW), (e: any) => e.status === 400);
  assert.throws(() => parseInBodyInput([1], "create", NOW), (e: any) => e.status === 400);
  assert.throws(() => parseInBodyInput("x", "patch", NOW), (e: any) => e.status === 400);
  // JSON.stringify(NaN) === "null": an optional blank field is simply absent on create
  assert.doesNotThrow(() => parseInBodyInput({ ...good, bodyFatPct: null, height: null }, "create", NOW));
});

test("InBody date: not in the future (14h timezone grace), not before 1900", () => {
  refuses({ ...good, date: "2030-01-01T00:00:00.000Z" }, "create", "date", /tương lai/);
  refuses({ ...good, date: "2026-11-16T00:00:00.000Z" }, "create", "date", /tương lai/);
  refuses({ ...good, date: "1899-12-31T00:00:00.000Z" }, "create", "date", /1900/);
  assert.doesNotThrow(() => parseInBodyInput({ ...good, date: "2026-11-14T00:00:00.000Z" }, "create", NOW));
  assert.doesNotThrow(() => parseInBodyInput({ ...good, date: "2026-11-15T00:00:00.000Z" }, "create", NOW), "UTC+14 user's today");
  assert.doesNotThrow(() => parseInBodyInput({ ...good, date: "1900-01-01T00:00:00.000Z" }, "create", NOW));
});

test("InBody patch: null clears optional columns but is refused for required ones", () => {
  assert.deepEqual(parseInBodyInput({ height: null, notes: null, bmr: null }, "patch", NOW), { height: null, notes: null, bmr: null });
  for (const f of ["weight", "muscleMass", "bodyFat", "date"]) refuses({ [f]: null }, "patch", f, /không được để trống/);
});

test("InBody cross-field: muscle mass and fat mass must be below weight", () => {
  assert.throws(() => assertInBodyConsistent({ weight: 70, muscleMass: 70, bodyFat: 10 }), (e: any) => e.status === 400 && e.field === "muscleMass");
  assert.throws(() => assertInBodyConsistent({ weight: 70, muscleMass: 30, bodyFat: 80 }), (e: any) => e.status === 400 && e.field === "bodyFat");
  assert.doesNotThrow(() => assertInBodyConsistent({ weight: 70, muscleMass: 30, bodyFat: 12 }));
});

test("N13G-06: a vision result with every metric 0/null is NOT readable; one real core metric is", () => {
  assert.equal(hasReadableInBodyMetrics({ weight: 0, skeletal_muscle_mass: 0, body_fat_mass: 0 }), false);
  assert.equal(hasReadableInBodyMetrics({ weight: null, skeletal_muscle_mass: null, body_fat_mass: null, height: 170 }), false);
  assert.equal(hasReadableInBodyMetrics({}), false);
  assert.equal(hasReadableInBodyMetrics(null), false);
  assert.equal(hasReadableInBodyMetrics({ weight: 72.4, skeletal_muscle_mass: 0 }), true);
  assert.equal(hasReadableInBodyMetrics({ body_fat_mass: 14 }), true);
});

// ── N13A-04 profile limits ─────────────────────────────────────────────────────────────────────────────────
function profileIssues(body: unknown): string[] {
  const r = profileSchema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}
const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 86400_000).toISOString().slice(0, 10);

test("profile limits - height 100..250 and weights 20..400", () => {
  for (const h of [30, 99999, 99, 251]) assert.match(profileIssues({ heightCm: h })[0], /Chiều cao phải từ 100 đến 250/);
  for (const w of [5, 700, 1e9]) {
    assert.match(profileIssues({ currentWeight: w })[0], /Cân nặng phải từ 20 đến 400/);
    assert.match(profileIssues({ targetWeight: w })[0], /Cân nặng phải từ 20 đến 400/);
  }
  assert.deepEqual(profileIssues({ heightCm: 175, currentWeight: 72, targetWeight: 68 }), []);
});

test("profile limits - date of birth must be a real date and give an age of 13..100", () => {
  assert.match(profileIssues({ dateOfBirth: "abc" })[0], /Ngày sinh không hợp lệ/);
  assert.match(profileIssues({ dateOfBirth: "2099-01-01" })[0], /Tuổi phải từ 13 đến 100/);
  assert.match(profileIssues({ dateOfBirth: yearsAgo(10) })[0], /Tuổi phải từ 13 đến 100/);
  assert.match(profileIssues({ dateOfBirth: yearsAgo(120) })[0], /Tuổi phải từ 13 đến 100/);
  assert.deepEqual(profileIssues({ dateOfBirth: yearsAgo(25) }), []);
  assert.deepEqual(profileIssues({ dateOfBirth: "2000-01-15" }), []);
  assert.ok(profileIssues({ age: 12 }).length > 0);
  assert.ok(profileIssues({ age: 101 }).length > 0);
});

test("profile limits - string length and array size caps", () => {
  assert.ok(profileIssues({ dietaryPreference: "x".repeat(10_000) }).length > 0);
  assert.ok(profileIssues({ photoUrl: "x".repeat(10_000) }).length > 0);
  assert.ok(profileIssues({ injuries: Array(31).fill("a") }).length > 0);
  assert.ok(profileIssues({ injuries: ["x".repeat(201)] }).length > 0);
  assert.ok(profileIssues({ availableEquipment: Array(51).fill("a") }).length > 0);
  assert.ok(profileIssues({ safetyScreeningFlags: Array(31).fill("a") }).length > 0);
  assert.ok(profileIssues({ preferredTrainingDays: [0, 1, 2, 3, 4, 5, 6, 0] }).length > 0);
  assert.deepEqual(profileIssues({ injuries: ["đau gối"], availableEquipment: ["dumbbell"], dietaryPreference: "ăn chay" }), []);
});

// ── N13A-08 paging ─────────────────────────────────────────────────────────────────────────────────────────
test("notification paging: defaults when absent; negative / zero / huge / garbage are refused", () => {
  assert.deepEqual(parseNotificationPaging({}), { page: 1, limit: 20 });
  assert.deepEqual(parseNotificationPaging({ page: "3", limit: "100" }), { page: 3, limit: 100 });
  for (const q of [{ page: "-1" }, { page: "0" }, { limit: "0" }, { limit: "100000" }, { limit: "101" }, { page: "abc" }, { limit: "1.5" }, { page: ["1", "2"] }]) {
    assert.equal(parseNotificationPaging(q), null, JSON.stringify(q));
  }
});
