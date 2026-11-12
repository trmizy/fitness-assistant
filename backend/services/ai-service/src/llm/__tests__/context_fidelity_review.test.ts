// Review round P1-04 — context_fidelity_guard must not take "để" (in order to) for "đẻ" (give birth), must require an
// ASSERTION by the user as evidence, and must remove only the offending sentence.
// Every expectation below is written by hand from the intended behaviour, not derived from the production regexes.
import test from "node:test";
import assert from "node:assert/strict";
import { removeUnsupportedUserClaims } from "../context_fidelity_guard";

const run = (answer: string, question: string, extra: { sessionUserMessages?: string[]; verifiedProfileFacts?: { postpartum?: boolean; pregnant?: boolean } } = {}) =>
  removeUnsupportedUserClaims(answer, { question, ...extra });

// ───────────────────────────── P1-04 reproduction ─────────────────────────────
test("P1-04: 'để' (in order to) is not evidence of a birth — the congratulation is removed, the advice stays", () => {
  const r = run("Chúc mừng bạn đã bắt đầu tập sau sinh! Hãy tập Hip Thrust.", "Tôi tập để tăng cơ mông.");
  assert.equal(r.answer, "Hãy tập Hip Thrust.");
  assert.equal(r.removed.length, 1);
  assert.match(r.removed[0], /Chúc mừng/);
});

test("P1-04: same ambiguity with other 'đ'-words typed WITHOUT accents ('de', 'dat', 'mo') is never evidence", () => {
  // unaccented user input: "de tang co" (để), "dat muc tieu" (đặt), "mo" (mở) — none is a health state or an achievement
  assert.equal(run("Chúc mừng bạn đã bắt đầu tập sau sinh! Hãy tập Hip Thrust.", "toi tap de tang co mong").answer, "Hãy tập Hip Thrust.");
  assert.equal(run("Chúc mừng bạn đã đạt mục tiêu 78kg! Hãy giữ thói quen ăn uống đều đặn.", "toi muon dat muc tieu 78kg, mo bai tap giup toi").answer, "Hãy giữ thói quen ăn uống đều đặn.");
  // sau phau thuat claim, user only said "mo" (open) / "mở"
  assert.equal(run("Vì bạn đang phục hồi sau phẫu thuật nên cần tập nhẹ. Hãy tập 3 buổi mỗi tuần.", "Mở giúp tôi bài tập mông").answer, "Hãy tập 3 buổi mỗi tuần.");
});

// ───────────────────────────── life events: what counts as evidence ─────────────────────────────
test("an assertion INSIDE a question counts: 'Tôi vừa sinh con được 6 tuần, giờ tập bụng được chưa?'", () => {
  const answer = "Sau sinh 6 tuần nên hỏi bác sĩ trước khi tập bụng. Chúc mừng bạn đã sinh con! Bắt đầu bằng bài thở bụng nhẹ.";
  const r = run(answer, "Tôi vừa sinh con được 6 tuần, giờ tập bụng được chưa?");
  assert.equal(r.answer, answer, "the user stated it (first clause) → nothing removed");
  assert.deepEqual(r.removed, []);
});

test("an assertion in an EARLIER message of the same session counts", () => {
  const answer = "Bạn đang trong giai đoạn sau sinh nên hãy tăng tải từ từ.";
  assert.equal(run(answer, "Tập mông thế nào cho đúng?", { sessionUserMessages: ["Em mới sinh con được 2 tháng."] }).answer, answer);
});

test("a hypothetical is not evidence: attribution removed, generic advice kept", () => {
  const answer = "Bạn đã sinh con nên cần chờ ít nhất 6 tuần. Sau sinh thường, bạn nên bắt đầu bằng bài thở và đi bộ nhẹ.";
  const r = run(answer, "Nếu tôi vừa sinh con thì tập được không?");
  assert.equal(r.answer, "Sau sinh thường, bạn nên bắt đầu bằng bài thở và đi bộ nhẹ.");
  assert.equal(r.removed.length, 1);
  assert.match(r.removed[0], /Bạn đã sinh con/);
});

test("a question about the topic is not evidence: generic postpartum advice kept, 'chúc mừng bạn đã sinh con' removed", () => {
  const answer = "Phụ nữ sau sinh thường đợi khoảng 6 tuần rồi mới tập bụng. Chúc mừng bạn đã sinh con! Hãy bắt đầu bằng bài thở.";
  const r = run(answer, "Sau sinh bao lâu được tập bụng?");
  assert.equal(r.answer, "Phụ nữ sau sinh thường đợi khoảng 6 tuần rồi mới tập bụng. Hãy bắt đầu bằng bài thở.");
  assert.equal(r.removed.length, 1);
});

test("topic asked by the user: advice addressed to 'bạn' with a modal is generic, not an attribution", () => {
  const answer = "Bạn nên chờ khoảng 6 tuần sau sinh rồi mới tập bụng. Bạn có thể bắt đầu bằng đi bộ.";
  assert.equal(run(answer, "Sau sinh bao lâu được tập bụng?").answer, answer);
});

test("topic NEVER mentioned: any sentence addressed to 'bạn' about a birth is removed", () => {
  const r = run("Sau sinh bạn nên chờ 6 tuần. Tập Hip Thrust 3 buổi mỗi tuần.", "Tập sao cho mông to hơn?");
  assert.equal(r.answer, "Tập Hip Thrust 3 buổi mỗi tuần.");
});

test("negation / planning / third person are not evidence", () => {
  const congrats = "Chúc mừng bạn đã sinh con! Hãy tập Hip Thrust nhé.";
  const expected = "Hãy tập Hip Thrust nhé.";
  for (const q of ["Tôi chưa sinh con, tập mông thế nào?", "Tôi dự định sinh con năm sau, giờ tập mông thế nào?", "Vợ tôi vừa sinh con, còn tôi muốn tập mông.", "Tôi không muốn sinh con, chỉ muốn tập mông."]) {
    assert.equal(run(congrats, q).answer, expected, q);
  }
});

test("'sinh nhật' / 'sinh viên' are not a birth", () => {
  const r = run("Chúc mừng bạn đã sinh con! Hãy tập Hip Thrust nhé.", "Tôi vừa sinh nhật 30 tuổi, em là sinh viên, muốn tập mông.");
  assert.equal(r.answer, "Hãy tập Hip Thrust nhé.");
});

test("unaccented multi-word phrases are accepted as evidence (documented choice); the single word 'de' is not", () => {
  const answer = "Bạn đang trong giai đoạn sau sinh nên tập nhẹ thôi.";
  assert.equal(run(answer, "toi vua sinh con 6 tuan roi, tap bung duoc chua?").answer, answer);
  // pregnancy is not a birth: the postpartum claim stays unsupported
  assert.equal(run(`${answer} Hãy đi bộ mỗi ngày.`, "em mang thai 5 thang, tap mong duoc khong").answer, "Hãy đi bộ mỗi ngày.");
});

test("a profile-VERIFIED fact is evidence; a memory is not (memories are never passed in)", () => {
  const answer = "Chúc mừng bạn đã sinh con! Hãy tập Hip Thrust nhé.";
  assert.equal(run(answer, "Tập mông thế nào?", { verifiedProfileFacts: { postpartum: true } }).answer, answer);
  assert.equal(run(answer, "Tập mông thế nào?", { verifiedProfileFacts: { pregnant: true } }).answer, "Hãy tập Hip Thrust nhé.", "a pregnancy fact is no evidence of a birth");
  assert.equal(run("Vì bạn đang mang thai nên tránh bài nặng. Hãy tập đi bộ.", "Tập sao?", { verifiedProfileFacts: { pregnant: true } }).answer, "Vì bạn đang mang thai nên tránh bài nặng. Hãy tập đi bộ.");
  assert.equal(run(answer, "Tập mông thế nào?", { verifiedProfileFacts: { postpartum: false } }).answer, "Hãy tập Hip Thrust nhé.");
});

test("pregnancy claim without evidence is removed at sentence level", () => {
  const r = run("Chúc mừng bạn đang mang thai! Hãy ưu tiên đi bộ. Vì bạn có bầu nên tránh bài nặng.", "Tập thế nào cho khỏe?");
  assert.equal(r.answer, "Hãy ưu tiên đi bộ.");
  assert.equal(r.removed.length, 2);
});

// ───────────────────────────── conditional safety notes stay ─────────────────────────────
test("conditional safety disclaimers are never removed", () => {
  for (const answer of [
    "Nếu bạn đang mang thai, hãy tham khảo chuyên gia y tế.",
    "Khoảng 1,6 g/kg/ngày. Nếu bạn có bệnh lý, đang mang thai hoặc dưới 18 tuổi, hãy hỏi bác sĩ trước.",
    "If you are pregnant or recently had surgery, talk to your doctor first.",
    "Trong trường hợp bạn vừa sinh con, hãy hỏi bác sĩ trước khi tập bụng.",
    "Lưu ý an toàn: nếu bạn thuộc nhóm sau thì hỏi bác sĩ trước:\n- Bạn đang mang thai\n- Bạn mới phẫu thuật",
  ]) {
    assert.equal(run(answer, "Mỗi ngày tôi nên ăn bao nhiêu calo để giảm mỡ?").answer, answer, answer);
  }
});

test("a question put to the user is not an attribution", () => {
  const answer = "Bạn có đang mang thai hoặc mới sinh con không? Nếu có hãy hỏi bác sĩ.";
  assert.equal(run(answer, "Tôi nên ăn bao nhiêu protein?").answer, answer);
});

// ───────────────────────────── achievements ─────────────────────────────
test("a goal is not an achievement: 'Mục tiêu từ 85 kg xuống 78 kg' + congratulation → removed", () => {
  const r = run("**Chúc mừng! Bạn đã đạt mục tiêu 78kg.**\n\nĐể giữ cân, ăn đủ đạm mỗi ngày.", "Mục tiêu từ 85 kg xuống 78 kg, nên ăn thế nào?");
  assert.equal(r.answer, "Để giữ cân, ăn đủ đạm mỗi ngày.");
  assert.equal(r.removed.length, 1, "the bare 'Chúc mừng!' and its achievement sentence form ONE removed unit");
});

test("a stated result IS evidence: 'Tôi đã giảm từ 85 kg xuống 78 kg' + the same congratulation → kept byte-for-byte", () => {
  const answer = "**Chúc mừng! Bạn đã đạt mục tiêu 78kg.**\n\nĐể giữ cân, ăn đủ đạm mỗi ngày.";
  const r = run(answer, "Tôi đã giảm từ 85 kg xuống 78 kg, giờ nên ăn thế nào?");
  assert.equal(r.answer, answer);
  assert.deepEqual(r.removed, []);
});

test("'đặt mục tiêu' (set a goal) is not 'đạt mục tiêu' (reached) — accented text is compared, not the folded one", () => {
  const r = run("Chúc mừng bạn đã đạt mục tiêu! Hãy ăn đủ đạm mỗi ngày.", "Tôi muốn đặt mục tiêu 78kg");
  assert.equal(r.answer, "Hãy ăn đủ đạm mỗi ngày.");
  // and the reverse: a congratulation for SETTING a goal is not an achievement claim
  const setGoal = "Chúc mừng bạn đã đặt mục tiêu rõ ràng! Hãy ăn đủ đạm mỗi ngày.";
  assert.equal(run(setGoal, "Tôi muốn đặt mục tiêu 78kg").answer, setGoal);
});

test("wanting to reach a goal is not having reached it", () => {
  const r = run("Chúc mừng bạn đã đạt được mục tiêu! Hãy ăn đủ đạm mỗi ngày.", "Tôi muốn đạt mục tiêu 78kg thì làm sao?");
  assert.equal(r.answer, "Hãy ăn đủ đạm mỗi ngày.");
});

test("a stated goal in an earlier session message is not evidence either (B3-47 shape)", () => {
  const r = run("**Chúc mừng! Bạn đã đạt được mục tiêu giảm xuống 78kg.** 🎉\n\nĐề xuất giảm 0.5-1kg mỗi tuần.", "Vậy tôi nên giảm bao nhiêu kg mỗi tuần?", { sessionUserMessages: ["Mục tiêu của tôi là giảm từ 85 xuống 78kg."] });
  assert.doesNotMatch(r.answer, /Chúc mừng|đạt được|🎉/);
  assert.match(r.answer, /0\.5-1kg mỗi tuần/);
});

// ───────────────────────────── sentence-level removal, never an empty answer ─────────────────────────────
test("a line that mixes a false congratulation sentence and valid advice keeps the advice (and its bullet)", () => {
  const r = run("- Chúc mừng bạn đã sinh con! Hãy bắt đầu bằng Hip Thrust nhẹ, 3 hiệp 12 lần.\n- Tập 3 buổi mỗi tuần.", "Tập sao cho mông to hơn?");
  assert.equal(r.answer, "- Hãy bắt đầu bằng Hip Thrust nhẹ, 3 hiệp 12 lần.\n- Tập 3 buổi mỗi tuần.");
});

test("the emoji after a removed congratulation goes with it", () => {
  const r = run("Chúc mừng bạn đã quyết định bắt đầu tập luyện sau khi sinh con! 🎉 Với mục tiêu tăng vòng ba, ưu tiên Hip Thrust.", "Em muốn vòng ba to hơn, tập sao?");
  assert.equal(r.answer, "Với mục tiêu tăng vòng ba, ưu tiên Hip Thrust.");
});

test("an unbalanced markdown bold marker is not left behind", () => {
  const r = run("**Bạn đã sinh con nên cần nghỉ. Hãy tập nhẹ nhàng, nghỉ 60 giây giữa các hiệp.**", "Tập mông thế nào?");
  assert.equal(r.answer, "Hãy tập nhẹ nhàng, nghỉ 60 giây giữa các hiệp.");
});

test("an answer made only of a false claim is NOT emptied: original returned, nothing 'removed', a warning explains", () => {
  const answer = "Chúc mừng bạn đã sinh con!";
  const r = run(answer, "Tôi tập để tăng cơ mông.");
  assert.equal(r.answer, answer);
  assert.deepEqual(r.removed, []);
  assert.ok(r.warnings && r.warnings.length === 1, "one warning");
  assert.deepEqual(r.suppressed, [answer]);
});

test("an answer whose only remainder is a stub is also kept with a warning", () => {
  const answer = "**Chúc mừng! Bạn đã đạt mục tiêu 78kg.** 🎉 Ok.";
  const r = run(answer, "Mục tiêu của tôi là 78kg.");
  assert.equal(r.answer, answer);
  assert.equal(r.warnings?.length, 1);
});

test("fully valid answers come out byte-identical (whitespace and markdown untouched)", () => {
  for (const [answer, q] of [
    ["Ăn  đủ đạm 1,6 g/kg.\n\n\n- Tập 3 buổi/tuần.  \n**Lưu ý**: ngủ đủ.", "Tôi nên ăn bao nhiêu calo để giảm mỡ?"],
    ["Chúc mừng bạn đã giảm được 3kg! Tiếp tục giữ thâm hụt vừa phải.", "Tôi đã giảm được 3kg sau 1 tháng, giờ nên làm gì?"],
    ["Chúc mừng bạn đã bắt đầu hành trình tập luyện! Hãy tập đều.", "Tôi mới bắt đầu tập."],
  ] as const) {
    const r = run(answer, q);
    assert.equal(r.answer, answer);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.warnings, []);
  }
});

test("the ACCENTED word 'đẻ' / 'mổ' is evidence, the accented 'để' / 'mở' is not", () => {
  const birth = "Chúc mừng bạn vừa đẻ! Hãy bắt đầu bằng bài thở nhẹ nhàng.";
  assert.equal(run(birth, "Em vừa đẻ được 2 tháng, tập mông được chưa?").answer, birth);
  assert.equal(run(birth, "Em tập để giảm mỡ, tập mông được chưa?").answer, "Hãy bắt đầu bằng bài thở nhẹ nhàng.");
  const surgery = "Vì bạn mới mổ nên hãy tập nhẹ. Hãy đi bộ mỗi ngày.";
  assert.equal(run(surgery, "Tôi mới mổ ruột thừa, tập được chưa?").answer, surgery);
  assert.equal(run(surgery, "Tôi mở app để xem lịch, tập gì?").answer, "Hãy đi bộ mỗi ngày.");
});
