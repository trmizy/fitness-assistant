import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTurnFacts, extractFactsFromText, applyTurnFacts, formatTurnFactsForPrompt } from "../turn_facts";
import type { UserProfile } from "../types";

/**
 * Independent-review fixes (2026-11-12): P1-01 equipment extraction ("tạ đơn" vs "tạ đòn" collapsed by diacritic folding) and
 * P1-02 hypothetical / negated facts ("Nếu tôi 16 tuổi…" was extracted as a confirmed age).
 * Every expected value below is written by hand from the Vietnamese / English MEANING of the sentence — none is computed by
 * calling the production function.
 */

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  age: 30, gender: "FEMALE", heightCm: 160, currentWeightKg: 60, goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE",
  training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] },
  ...over,
} as UserProfile);

const eq = (text: string) => extractTurnFacts(text, {}).equipment;
const sorted = (a: readonly string[] | undefined) => [...(a ?? [])].sort();

// ───────────────────────── P1-01 equipment ─────────────────────────

test("P1-01: 'chỉ có tạ đòn' is a BARBELL, not a dumbbell", () => {
  const e = eq("Tôi chỉ có tạ đòn, hãy lên lịch tập.");
  assert.deepEqual(sorted(e?.value), ["barbell", "bodyweight"]);
  assert.equal(e?.status, "ASSERTED");
});

test("P1-01: 'chỉ có tạ đơn' is a DUMBBELL, not a barbell", () => {
  assert.deepEqual(sorted(eq("Tôi chỉ có tạ đơn.")?.value), ["bodyweight", "dumbbell"]);
});

test("P1-01: 'có cả tạ đòn và tạ đơn' — first-person possession lists both (documented: possession of NAMED kit counts as the available kit)", () => {
  assert.deepEqual(sorted(eq("Tôi có cả tạ đòn và tạ đơn.")?.value), ["barbell", "bodyweight", "dumbbell"]);
});

test("P1-01: negation is scoped per item — 'không có tạ đơn nhưng có tạ đòn' ⇒ barbell yes, dumbbell no", () => {
  const v = eq("Tôi không có tạ đơn nhưng có tạ đòn.")?.value ?? [];
  assert.ok(v.includes("barbell"), String(v));
  assert.ok(!v.includes("dumbbell"), String(v));
});

test("P1-01: 'chỉ có thanh barbell' ⇒ barbell", () => {
  assert.ok((eq("Tôi chỉ có thanh barbell.")?.value ?? []).includes("barbell"));
  assert.ok(!(eq("Tôi chỉ có thanh barbell.")?.value ?? []).includes("dumbbell"));
});

test("P1-01: 'có dumbbell, không có barbell' ⇒ dumbbell yes, barbell no", () => {
  const v = eq("Tôi có dumbbell, không có barbell.")?.value ?? [];
  assert.ok(v.includes("dumbbell") && !v.includes("barbell"), String(v));
});

test("P1-01: 'ở nhà không có dụng cụ' ⇒ bodyweight only", () => {
  assert.deepEqual(eq("Tôi tập ở nhà không có dụng cụ.")?.value, ["bodyweight"]);
});

test("P1-01: 'có dây kháng lực và xà đơn' ⇒ resistance_band + pull-up bar", () => {
  const v = eq("Tôi có dây kháng lực và xà đơn.")?.value ?? [];
  assert.ok(v.includes("resistance_band") && v.includes("pullup_bar"), String(v));
  assert.ok(!v.includes("dumbbell"), "xà đơn must not be read as tạ đơn");
});

test("P1-01: a list after one negation stays negated ('không có tạ đơn, tạ đòn') — nothing positive ⇒ bodyweight only", () => {
  const v = eq("Tôi không có tạ đơn, tạ đòn.")?.value ?? [];
  assert.ok(!v.includes("dumbbell") && !v.includes("barbell"), String(v));
  assert.deepEqual(v, ["bodyweight"]);
});

test("P1-01: unaccented 'ta don' is genuinely ambiguous (đơn/đòn) — neither is guessed, status UNKNOWN", () => {
  const e = eq("Toi chi co ta don.");
  assert.ok(e, "something was stated");
  assert.ok(!e!.value.includes("dumbbell") && !e!.value.includes("barbell"), String(e!.value));
  assert.equal(e!.status, "UNKNOWN");
  assert.match(formatTurnFactsForPrompt(extractTurnFacts("Toi chi co ta don.", {})), /chưa rõ/);
});

test("P1-01: unaccented 'ta don' + English context disambiguates", () => {
  assert.ok((eq("Toi chi co ta don (dumbbell).")?.value ?? []).includes("dumbbell"));
  assert.ok(!(eq("Toi chi co ta don (dumbbell).")?.value ?? []).includes("barbell"));
  assert.ok((eq("Toi chi co barbell, ta don.")?.value ?? []).includes("barbell"));
});

test("P1-01: unaccented unambiguous words still work ('ta tay', 'ta am', 'xa don', 'day khang luc')", () => {
  assert.ok((eq("toi chi co ta tay")?.value ?? []).includes("dumbbell"));
  assert.ok((eq("toi chi co ta am")?.value ?? []).includes("kettlebell"));
  assert.ok((eq("toi chi co xa don")?.value ?? []).includes("pullup_bar"));
  assert.ok((eq("toi chi co day khang luc")?.value ?? []).includes("resistance_band"));
});

test("P1-01: merely NAMING kit / an exercise is not a restriction (Layer-1 B3-15 protection kept)", () => {
  assert.equal(eq("Chưa kéo xà đơn nổi thì tập gì?"), undefined);
  assert.equal(eq("Bài tạ đơn nào tốt cho ngực?"), undefined);
  assert.equal(eq("Em có tập tạ đơn được không?"), undefined);
  assert.equal(eq("Tạ đòn hay tạ đơn tốt hơn?"), undefined);
});

// ───────────────────────── P1-02 hypothetical / negated ─────────────────────────

test("P1-02: 'Nếu tôi 16 tuổi thì sao?' ⇒ age 16 HYPOTHETICAL (still returned for the answer)", () => {
  const a = extractTurnFacts("Nếu tôi 16 tuổi thì sao?", {}).ageYears;
  assert.equal(a?.value, 16);
  assert.equal(a?.status, "HYPOTHETICAL");
});

test("P1-02: 'Tôi 16 tuổi.' ⇒ ASSERTED", () => {
  const a = extractTurnFacts("Tôi 16 tuổi.", {}).ageYears;
  assert.deepEqual([a?.value, a?.status], [16, "ASSERTED"]);
});

test("P1-02: 'Tôi không phải 16 tuổi.' ⇒ no ASSERTED 16", () => {
  const a = extractTurnFacts("Tôi không phải 16 tuổi.", {}).ageYears;
  assert.ok(a === undefined || a.status === "NEGATED", JSON.stringify(a));
  const b = extractTurnFacts("I am not 16 years old.", {}).ageYears;
  assert.ok(b === undefined || b.status === "NEGATED", JSON.stringify(b));
  // the denial must not turn into a profile-overriding fact either
  const c = extractTurnFacts("Tôi không phải 16 tuổi.", { profile: profile({ age: 16 }) });
  assert.equal(c.ageYears?.value, 16);
  assert.equal(c.ageYears?.source, "profile");
});

test("P1-02: 'Giả sử tôi 52 tuổi.' ⇒ HYPOTHETICAL", () => {
  const a = extractTurnFacts("Giả sử tôi 52 tuổi.", {}).ageYears;
  assert.deepEqual([a?.value, a?.status], [52, "HYPOTHETICAL"]);
});

test("P1-02: 'Em sắp 60 tuổi' stays ASSERTED approximate", () => {
  const a = extractTurnFacts("Em sắp 60 tuổi", { profile: profile({ age: 52 }) }).ageYears;
  assert.deepEqual([a?.value, a?.status, a?.approximate], [60, "ASSERTED", true]);
});

test("P1-02: a fact in a separate asserted clause stays ASSERTED ('Tôi 30 tuổi, nếu tôi tập 6 buổi thì sao?')", () => {
  const a = extractTurnFacts("Tôi 30 tuổi, nếu tôi tập 6 buổi thì sao?", {}).ageYears;
  assert.deepEqual([a?.value, a?.status], [30, "ASSERTED"]);
  const b = extractTurnFacts("Nếu tôi tập 6 buổi thì sao? Tôi 30 tuổi.", {}).ageYears;
  assert.deepEqual([b?.value, b?.status], [30, "ASSERTED"]);
});

test("P1-02: stated 17 vs profile 16 — stated 17 ASSERTED, both minors, conflict recorded, not safety-crossing", () => {
  const f = extractTurnFacts("Tôi 17 tuổi nhưng profile là 16", { profile: profile({ age: 16 }) });
  assert.deepEqual([f.ageYears?.value, f.ageYears?.status, f.ageYears?.source], [17, "ASSERTED", "message"]);
  const c = f.conflicts.filter((x) => x.field === "age");
  assert.equal(c.length, 1);
  assert.equal(c[0].safetyRelevant, false);
});

test("P1-02: asserted adult claim against a minor profile still resolves to the minor reading + safety conflict (unchanged)", () => {
  const f = extractTurnFacts("Mình 19 tuổi rồi, cho mình lịch tập nặng", { profile: profile({ age: 16 }) });
  assert.equal(f.ageYears?.value, 16);
  assert.equal(f.conflicts.find((c) => c.field === "age")?.safetyRelevant, true);
});

test("P1-02: 'Nếu tôi không có dụng cụ thì tập gì?' ⇒ equipment HYPOTHETICAL bodyweight", () => {
  const e = extractTurnFacts("Nếu tôi không có dụng cụ thì tập gì?", {}).equipment;
  assert.deepEqual([e?.value, e?.status], [["bodyweight"], "HYPOTHETICAL"]);
});

test("P1-02: 'Nếu ở nhà không có tạ thì tập thế nào?' ⇒ equipment and location HYPOTHETICAL", () => {
  const f = extractTurnFacts("Nếu ở nhà không có tạ thì tập thế nào?", {});
  assert.deepEqual([f.equipment?.value, f.equipment?.status], [["bodyweight"], "HYPOTHETICAL"]);
  assert.deepEqual([f.location?.value, f.location?.status], ["home", "HYPOTHETICAL"]);
});

test("P1-02: 'Tôi không có dụng cụ.' stays an ASSERTED restriction (the negation is the content)", () => {
  const e = extractTurnFacts("Tôi không có dụng cụ.", {}).equipment;
  assert.deepEqual([e?.value, e?.status], [["bodyweight"], "ASSERTED"]);
});

test("P1-02: an asserted sentence plus a hypothetical sentence — the asserted fact wins the field", () => {
  const e = extractTurnFacts("Tôi chỉ có tạ đơn. Nếu tôi không có dụng cụ thì sao?", {}).equipment;
  assert.deepEqual([sorted(e?.value), e?.status], [["bodyweight", "dumbbell"], "ASSERTED"]);
});

test("P1-02: English markers (if / suppose)", () => {
  assert.equal(extractTurnFacts("If I were 16 years old, can I lift heavy?", {}).ageYears?.status, "HYPOTHETICAL");
  assert.equal(extractTurnFacts("Suppose I only have dumbbells, what should I do?", {}).equipment?.status, "HYPOTHETICAL");
  assert.equal(extractTurnFacts("I am 16 years old.", {}).ageYears?.status, "ASSERTED");
});

test("P1-02: 'gia sư' (a tutor) is not the hypothetical marker 'giả sử'", () => {
  assert.equal(extractTurnFacts("Tôi có gia sư kèm, tôi 30 tuổi.", {}).ageYears?.status, "ASSERTED");
});

test("P1-02: location / injury negation — 'không ở nhà', 'không đau lưng' are not stated as home / injured", () => {
  const f = extractTurnFacts("Tôi không ở nhà, tôi tập ở phòng gym.", {});
  assert.equal(f.location?.value, "gym");
  assert.equal(extractFactsFromText("Tôi không đau lưng, muốn tập chân.").injuries, undefined);
  assert.deepEqual(extractFactsFromText("Tôi bị đau lưng.").injuries?.value, ["dau lung"]);
});

// ── earlier-session facts: only ASSERTED ones carry over ──

test("P1-02 (session): a hypothetical age in an earlier turn does not reach an unrelated later turn", () => {
  const f = extractTurnFacts("Plank giữ bao lâu?", { sessionUserMessages: ["Nếu tôi 16 tuổi thì tập được không?"] });
  assert.equal(f.ageYears, undefined);
});

test("P1-02 (session): hypothetical / negated earlier equipment is dropped, asserted earlier equipment still counts", () => {
  const hyp = extractTurnFacts("Lên giúp em một buổi tập chân", { sessionUserMessages: ["Nếu tôi không có dụng cụ thì tập gì?"] });
  assert.equal(hyp.equipment, undefined);
  const real = extractTurnFacts("Lên giúp em một buổi tập chân", { sessionUserMessages: ["Tôi không có dụng cụ."] });
  assert.deepEqual([real.equipment?.value, real.equipment?.source, real.equipment?.status], [["bodyweight"], "session", "ASSERTED"]);
  const neg = extractTurnFacts("Plank?", { sessionUserMessages: ["Tôi không phải 16 tuổi."] });
  assert.equal(neg.ageYears, undefined);
});

test("P1-02 (session): an earlier ASSERTED age still counts; a hypothetical in the same earlier message does not replace it", () => {
  const f = extractTurnFacts("Plank?", { sessionUserMessages: ["Nếu tôi 16 tuổi thì sao? Tôi 40 tuổi."] });
  assert.deepEqual([f.ageYears?.value, f.ageYears?.source, f.ageYears?.status], [40, "session", "ASSERTED"]);
});

// ── applyTurnFacts: minor protection ──

test("P1-02 (safety): profile 16 + 'Giả sử tôi 25 tuổi' ⇒ the answer context is still a minor", () => {
  const p0 = profile({ age: 16 });
  const f = extractTurnFacts("Giả sử tôi 25 tuổi, tập nặng được không?", { profile: p0 });
  assert.ok(!f.conflicts.some((c) => c.field === "age"), "a hypothetical age is not a profile conflict");
  const p = applyTurnFacts(p0, f);
  assert.ok((p.age ?? 99) < 18, `age ${p.age}`);
  assert.equal(p0.age, 16, "saved profile untouched");
  assert.match(formatTurnFactsForPrompt(f), /dưới 18 tuổi/);
});

test("P1-02 (safety): profile 30 + 'Nếu tôi 16 tuổi, tập nặng được không?' ⇒ the answer context is minor-safe, and the scenario is labelled", () => {
  const p0 = profile({ age: 30 });
  const f = extractTurnFacts("Nếu tôi 16 tuổi, tập nặng được không?", { profile: p0 });
  assert.equal(applyTurnFacts(p0, f).age, 16);
  const text = formatTurnFactsForPrompt(f);
  assert.match(text, /giả định trong câu hỏi, không phải thông tin thật của user/);
  assert.match(text, /dưới 18 tuổi/);
  assert.equal(p0.age, 30, "saved profile untouched");
});

test("P1-02 (safety): earlier session age 16 + current hypothetical adult age ⇒ still minor", () => {
  const p0 = profile({ age: 30 });
  const f = extractTurnFacts("Giả sử tôi 25 tuổi thì sao?", { profile: p0, sessionUserMessages: ["Em 16 tuổi"] });
  assert.ok((applyTurnFacts(p0, f).age ?? 99) < 18);
});

test("P1-02: a hypothetical adult scenario for an adult profile is applied to THIS answer only", () => {
  const p0 = profile({ age: 30 });
  const f = extractTurnFacts("Giả sử tôi 52 tuổi.", { profile: p0 });
  assert.equal(applyTurnFacts(p0, f).age, 52);
  assert.equal(p0.age, 30);
});

test("P1-02: hypothetical equipment is applied for the scenario answer; UNKNOWN equipment is never applied", () => {
  const p0 = profile({ training: { availableEquipment: ["dumbbell", "barbell"], injuries: [], preferredTrainingDays: [] } as any });
  const hyp = applyTurnFacts(p0, extractTurnFacts("Nếu tôi không có dụng cụ thì tập gì?", { profile: p0 }));
  assert.deepEqual(hyp.training.availableEquipment, ["bodyweight"]);
  const unk = applyTurnFacts(p0, extractTurnFacts("Toi chi co ta don.", { profile: p0 }));
  assert.deepEqual(unk.training.availableEquipment, ["dumbbell", "barbell"]);
});

test("P1-02: hypothetical facts never create a profile conflict; asserted ones still do", () => {
  const p0 = profile({ age: 30, experienceLevel: "INTERMEDIATE" });
  assert.equal(extractTurnFacts("Nếu tôi mới tập thì bắt đầu từ đâu?", { profile: p0 }).conflicts.length, 0);
  assert.ok(extractTurnFacts("Tôi mới tập, bắt đầu từ đâu?", { profile: p0 }).conflicts.some((c) => c.field === "experience"));
});

test("P1-02: format labels every hypothetical field as a scenario and asserted ones stay unlabelled", () => {
  const hyp = formatTurnFactsForPrompt(extractTurnFacts("Nếu ở nhà không có tạ thì tập thế nào?", {}));
  assert.match(hyp, /Dụng cụ.*giả định trong câu hỏi, không phải thông tin thật của user/);
  assert.match(hyp, /Nơi tập.*giả định trong câu hỏi/);
  const real = formatTurnFactsForPrompt(extractTurnFacts("Tôi 52 tuổi, ở nhà không có dụng cụ.", {}));
  assert.doesNotMatch(real, /giả định/);
  assert.match(real, /TUYỆT ĐỐI không đề xuất bài cần dụng cụ khác/);
});
