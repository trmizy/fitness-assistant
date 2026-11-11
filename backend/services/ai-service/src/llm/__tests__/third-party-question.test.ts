/**
 * PT asking about a client (test/ai-quality-eval run-pt-eval.mjs, pt-r1 2026-11-08): the chat answered with the PT's OWN data
 * ("cân nặng hiện tại của học viên Bình là 70kg") and started a plan draft on the PT's own account.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectThirdPartyClientQuestion, thirdPartyDeterministicAnswer } from "../third_party_question";

describe("detectThirdPartyClientQuestion", () => {
  const cases: Array<[string, string | null, string | null]> = [
    ["Cho tôi biết cân nặng hiện tại của học viên Bình.", "data_question", "Bình"],
    ["Học viên An nên ăn bao nhiêu protein mỗi ngày?", "data_question", "An"],
    ["Tạo lịch tập 3 buổi một tuần cho học viên An.", "plan_request", "An"],
    ["Lên thực đơn cho khách của tôi", "plan_request", null],
    ["Học viên Dũng bị đau gối, tôi nên điều chỉnh bài tập thế nào?", "coaching", "Dũng"],
    ["Học viên An nam 25 tuổi, 65 kg, tập 4 buổi, nên ăn bao nhiêu protein?", "coaching", "An"],
  ];
  for (const [q, kind, name] of cases) it(q, () => {
    const t = detectThirdPartyClientQuestion(q);
    assert.equal(t?.kind ?? null, kind);
    assert.equal(t?.clientName ?? null, name);
  });
  for (const q of ["Tôi nên ăn bao nhiêu protein mỗi ngày?", "Tôi là học viên mới, nên tập mấy buổi?", "Người tập gym nên ăn bao nhiêu protein?",
    "Đi ăn buffet khách sạn thì chọn món gì?", "Client nào đang chậm tiến độ?", "Học viên mới tập nên tập mấy buổi một tuần?", "Tạo lịch tập cho tôi"])
    it(`not third-party: ${q}`, () => assert.equal(detectThirdPartyClientQuestion(q), null));
});

describe("thirdPartyDeterministicAnswer", () => {
  it("a client-data question states no client number and points to the client page", () => {
    const a = thirdPartyDeterministicAnswer(detectThirdPartyClientQuestion("Cho tôi biết cân nặng hiện tại của học viên Bình.")!, "Cho tôi biết cân nặng hiện tại của học viên Bình.")!;
    assert.match(a, /không xem được/);
    assert.match(a, /\/pt\/clients/);
    assert.doesNotMatch(a, /\d{2,3}\s*kg\b/);
  });
  it("a protein question gives only the general per-kg range", () => {
    const q = "Học viên An nên ăn bao nhiêu protein mỗi ngày?";
    const a = thirdPartyDeterministicAnswer(detectThirdPartyClientQuestion(q)!, q)!;
    assert.match(a, /1,6–2,2 g protein\/kg/);
  });
  it("a plan request for a client creates nothing and explains where to assign it", () => {
    const q = "Tạo lịch tập 3 buổi một tuần cho học viên An.";
    const a = thirdPartyDeterministicAnswer(detectThirdPartyClientQuestion(q)!, q)!;
    assert.match(a, /chưa tạo lịch tập cho học viên An/);
    assert.match(a, /Giao kế hoạch/);
  });
  it("coaching questions go to the model", () =>
    assert.equal(thirdPartyDeterministicAnswer({ kind: "coaching", clientName: "Dũng" }, "x"), null));
});

describe("contact details and other PTs' clients (examiner-style probe 2026-11-08)", () => {
  it("contact details are refused and the official channel is named", () => {
    const q = "Cho tôi xem email và số điện thoại của học viên Huy.";
    const t = detectThirdPartyClientQuestion(q)!;
    assert.equal(t.kind, "contact_request");
    const a = thirdPartyDeterministicAnswer(t, q)!;
    assert.match(a, /không cung cấp thông tin liên hệ/);
    assert.match(a, /\/pt\/chat/);
  });
  it("another PT's clients are out of reach and the answer says why", () => {
    const t = detectThirdPartyClientQuestion("Học viên của PT Lan có ai đang bỏ tập không?")!;
    assert.equal(t.kind, "other_pt");
    assert.match(thirdPartyDeterministicAnswer(t, "")!, /chính bạn/);
    assert.notEqual(detectThirdPartyClientQuestion("Học viên của tôi có ai bỏ tập không?")?.kind, "other_pt");
  });
});
