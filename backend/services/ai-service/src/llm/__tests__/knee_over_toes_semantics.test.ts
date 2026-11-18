/**
 * V1 RC1 (2026-11-12) — B2-21 (REAL HTTP/API, rc-verify-v1b) stated "Đầu gối không được vượt quá ngón chân khi hạ." and the
 * knee_over_toes detector (which only knew "mũi chân") missed it; B3-19's answer REFUTED the myth ("ép gối không vượt mũi chân
 * có thể làm tăng tải lên hông") and was flagged. The claim is now judged by its structure — knee + travel + toes/foot, the
 * polarity of the statement, and whether it is refuted / quoted / conditional / a question — not by one phrase.
 * Evidence (unchanged, already in the rule): Fry 2003; Hartmann 2013. Oracle: hand-labelled sentences.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectMythClaims, formatClaimRulesForPrompt } from "../claim_rules";

const isMyth = (s: string) => detectMythClaims(s).some((m) => m.id === "knee_over_toes");

for (const s of [
  "Đầu gối không được vượt quá ngón chân khi hạ.", // B2-21 verbatim
  "Tránh để gối vượt qua mũi chân khi squat.",
  "Đừng bao giờ để đầu gối vượt ra khỏi bàn chân.",
  "Gối tuyệt đối không được vượt mũi chân.",
  "Never let your knees go past your toes.",
]) test(`myth: "${s}"`, () => assert.equal(isMyth(s), true));

for (const s of [
  "Việc ép gối không vượt mũi chân có thể làm tăng tải lên hông và lưng dưới.", // B3-19 refutation
  "Nhiều người nghĩ gối không được vượt mũi chân, nhưng điều này không đúng.",
  "Đầu gối vượt mũi chân là bình thường nếu đi theo hướng mũi chân.",
  "Gối có thể vượt mũi chân tùy bài tập và khả năng vận động cổ chân.",
  "Nếu đang đau gối, hãy tạm thời hạn chế gối vượt mũi chân.",
  "Gối có được vượt mũi chân không?",
  "Giữ đầu gối theo hướng mũi chân khi hạ.",
  "It is a myth that your knees should never go past your toes.",
  // hedged in the same sentence (stored answer B2-21 coach-b2-run9, found by the offline replay 2026-11-12)
  "Một quy tắc chung là đầu gối không vượt quá mũi chân khi hạ xuống, nhưng điều này không phải là tuyệt đối nếu bạn kiểm soát được động tác.",
]) test(`not a myth: "${s}"`, () => assert.equal(isMyth(s), false));

test("the sourced rule is injected for knee/squat-depth questions, not for unrelated ones", () => {
  assert.match(formatClaimRulesForPrompt("Squat xuống sâu đến đâu thì an toàn cho đầu gối?"), /Fry 2003/); // B2-21 question
  assert.match(formatClaimRulesForPrompt("Khi tập lunge, đầu gối có được vượt qua mũi chân không?"), /Fry 2003/);
  assert.equal(formatClaimRulesForPrompt("Plank nên giữ bao lâu?"), "");
});
