/**
 * Health AI finding (REAL HTTP probe, Phase 4): "toi bi dau nguc va kho tho khi tap, co nen tap tiep khong" (unaccented Vietnamese) was
 * answered in ENGLISH — also by the medical-emergency template. Language detection must read unaccented Vietnamese without turning real
 * English into Vietnamese.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { languageGuard } from "../llm/language_guard";

const lang = (m: string) => languageGuard.resolve(m).responseLanguage;

test("unaccented Vietnamese (symptoms, questions, fitness requests) resolves to vi", () => {
  for (const m of [
    "toi bi dau nguc va kho tho khi tap, co nen tap tiep khong",
    "toi vua suyt ngat sau khi tap, tim dap rat nhanh",
    "hom nay toi bi chong mat va buon non",
    "toi muon giam can nhung khong biet bat dau tu dau",
    "dau goi cua toi khi len cau thang thi nen tap gi",
    "minh hay bi nhuc lung sau khi tap deadlift",
    "toi khong duoc khoe, nen nghi tap khong",
    "chan toi bi sung va dau",
  ]) assert.equal(lang(m), "vi", m);
});

test("accented Vietnamese and the earlier phrase list are unchanged", () => {
  assert.equal(lang("Tôi bị đau ngực"), "vi");
  assert.equal(lang("tao lich tap cho toi"), "vi");
  assert.equal(lang("thuc don giam mo"), "vi");
});

test("real English is NEVER turned into Vietnamese (incl. words that look like Vietnamese syllables)", () => {
  for (const m of [
    "I have chest pain and shortness of breath when I run, should I keep training?",
    "How do I tap into my full potential at the gym?",
    "Give me a chest workout with dumbbells",
    "What is the best way to get a big back and strong legs?",
    "My knee hurts when I climb stairs, can I squat today?",
    "Should I take a rest day after leg day",
    "Please create a meal plan for fat loss",
    "I am tired and have a bad back",
  ]) assert.equal(lang(m), "en", m);
});

test("too-short or ambiguous text defaults to English as before (never guessed)", () => {
  assert.equal(lang("ok"), "en");
  assert.equal(lang("toi"), "en");
  assert.equal(lang("tap"), "en");
});

test("an explicit language request still wins", () => {
  assert.equal(languageGuard.resolve("reply in english: toi bi dau nguc va kho tho khi tap", "lang-test-user-explicit").responseLanguage, "en");
});
