import test from "node:test";
import assert from "node:assert/strict";
import {
  compensationMoneySentence,
  formatVnd,
  PT_FAULT_SESSION_CLOSED,
  ptFaultClientMessage,
  ptFaultPtMessage,
  ptLateArrivalClientMessage,
  readPtFaultMoney,
  refundMoneySentence,
} from "../services/pt-fault-session-wording";

/** DQ-2(a): refund to wallet, session closed + counted, no replacement, PT not paid. The money sentence follows the real result. */

test("formatVnd groups thousands and drops the decimal part", () => {
  assert.equal(formatVnd("250000.00"), "250.000");
  assert.equal(formatVnd("1000000"), "1.000.000");
  assert.equal(formatVnd("0"), "0");
});

test("readPtFaultMoney: payment-service answer with paid/owed/unpaid", () => {
  assert.deepEqual(readPtFaultMoney({ paid: "250000.00", owed: "250000.00", unpaid: "0.00" }), {
    paid: "250000.00",
    owed: "250000.00",
    unpaid: "0.00",
  });
});

test("readPtFaultMoney: unwraps a SETTLED tracked outcome, ignores the other states", () => {
  const result = { paid: "100000", owed: "250000", unpaid: "150000" };
  assert.equal(readPtFaultMoney({ state: "SETTLED", applied: true, result })?.unpaid, "150000");
  for (const state of ["ALREADY_SETTLED", "IN_FLIGHT", "PARKED", "FAILED"]) assert.equal(readPtFaultMoney({ state, result }), null);
});

test("readPtFaultMoney: derives unpaid from owed - paid when only those are present", () => {
  assert.equal(readPtFaultMoney({ paid: "100000", owed: "250000" })?.unpaid, "150000");
});

test("readPtFaultMoney: older payment-service (no paid fields), void, garbage -> null", () => {
  assert.equal(readPtFaultMoney({ compensation: "250000", shortfall: "0" }), null);
  assert.equal(readPtFaultMoney(undefined), null);
  assert.equal(readPtFaultMoney(null), null);
  assert.equal(readPtFaultMoney("x"), null);
  assert.equal(readPtFaultMoney({ paid: "abc", unpaid: "0" }), null);
  assert.equal(readPtFaultMoney({ paid: "-5", unpaid: "0" }), null);
  assert.equal(readPtFaultMoney({ paid: "250000" }), null); // unpaid not knowable: do not guess
});

test("refund sentence: fully paid states the amount", () => {
  assert.equal(
    refundMoneySentence({ paid: "250000.00", owed: "250000.00", unpaid: "0.00" }),
    "Đã hoàn 250.000đ vào ví.",
  );
});

test("refund sentence: partly paid says what is still being reconciled and never claims a full refund", () => {
  const text = refundMoneySentence({ paid: "100000", owed: "250000", unpaid: "150000" });
  assert.equal(text, "Đã hoàn 100.000đ vào ví; 150.000đ còn lại đang được đối soát.");
  assert.doesNotMatch(text, /toàn bộ|đầy đủ|đã hoàn 250/i);
});

test("refund sentence: nothing paid yet but owed -> reconciling, no 'Đã hoàn'", () => {
  const text = refundMoneySentence({ paid: "0", owed: "250000", unpaid: "250000" });
  assert.match(text, /250\.000đ đang được đối soát/);
  assert.doesNotMatch(text, /Đã hoàn/);
});

test("refund sentence: unknown result is neutral and names no amount", () => {
  const text = refundMoneySentence(null);
  assert.doesNotMatch(text, /\d/);
  assert.doesNotMatch(text, /Đã hoàn/);
});

test("client message: closed + counted + no replacement, never 'không bị trừ'", () => {
  for (const money of [null, { paid: "250000", owed: "250000", unpaid: "0" }, { paid: "1", owed: "250000", unpaid: "249999" }]) {
    const text = ptFaultClientMessage("Huấn luyện viên vắng mặt.", money);
    assert.ok(text.startsWith("Huấn luyện viên vắng mặt."));
    assert.ok(text.includes(PT_FAULT_SESSION_CLOSED));
    assert.doesNotMatch(text, /không bị trừ/);
  }
  assert.match(PT_FAULT_SESSION_CLOSED, /vẫn tính vào số buổi đã dùng/);
  assert.match(PT_FAULT_SESSION_CLOSED, /không có buổi bù/);
});

test("PT message: session closed, value goes back to the client, PT is not paid, no amounts", () => {
  const text = ptFaultPtMessage("Bạn vắng mặt.");
  assert.match(text, /bạn không được thanh toán buổi này/);
  assert.doesNotMatch(text, /\d/);
});

test("late arrival: the session still counts; money sentence is a compensation, not a refund", () => {
  const paid = ptLateArrivalClientMessage({ paid: "125000", owed: "125000", unpaid: "0" }, "20/10/2026");
  assert.match(paid, /Đã bồi thường 125\.000đ vào ví\./);
  assert.match(paid, /vẫn được tính là đã diễn ra/);
  assert.match(paid, /trước 20\/10\/2026/);
  assert.doesNotMatch(paid, /không bị trừ/);

  const partial = compensationMoneySentence({ paid: "50000", owed: "125000", unpaid: "75000" });
  assert.equal(partial, "Đã bồi thường 50.000đ vào ví; 75.000đ còn lại đang được đối soát.");

  const unknown = ptLateArrivalClientMessage(null, "20/10/2026");
  assert.doesNotMatch(unknown, /\d+\.\d{3}đ/);
});
