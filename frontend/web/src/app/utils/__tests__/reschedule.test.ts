/**
 * Client-side reschedule explanations (pure). TEST FIXTURE - no browser run.
 * Run: node ../../node_modules/tsx/dist/cli.mjs --test src/app/utils/__tests__/reschedule.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedMovesOf,
  cancelSuccessText,
  dayEndsWithinLead,
  rescheduleBlockedReason,
  rescheduleErrorMessage,
  rescheduleSubmitHint,
} from "../reschedule";

const now = new Date(2026, 10, 22, 3, 0); // 22/11/2026 03:00 local
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

describe("rescheduleBlockedReason", () => {
  it("allows a confirmed session more than 12h away with no open proposal", () => {
    assert.equal(rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(30) }, { now }), null);
    assert.equal(rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(13), rescheduleRequests: [] }, { now }), null);
  });
  it("explains each refusal", () => {
    assert.match(rescheduleBlockedReason({ status: "REQUESTED", scheduledStartAt: inHours(30) }, { now })!, /PT xác nhận/);
    assert.match(rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(11) }, { now })!, /hơn 12 giờ/);
    assert.match(rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(-1) }, { now })!, /đã bắt đầu/);
    assert.match(
      rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(30), rescheduleRequests: [{ requestedBy: "CLIENT" }] }, { now })!,
      /đang chờ PT trả lời/,
    );
    assert.match(
      rescheduleBlockedReason({ status: "CONFIRMED", scheduledStartAt: inHours(30), rescheduleRequests: [{ requestedBy: "PT" }] }, { now })!,
      /PT đang đề nghị/,
    );
  });
});

describe("rescheduleSubmitHint", () => {
  it("names what is missing, in order", () => {
    assert.equal(rescheduleSubmitHint({ dateStr: null, slot: null, reason: "" }), "Chọn ngày mới.");
    assert.equal(rescheduleSubmitHint({ dateStr: "2026-11-25", slot: "", reason: "x" }), "Chọn khung giờ mới.");
    assert.equal(rescheduleSubmitHint({ dateStr: "2026-11-25", slot: "08:00", reason: "  " }), "Nhập lý do dời lịch.");
    assert.equal(rescheduleSubmitHint({ dateStr: "2026-11-25", slot: "08:00", reason: "Bận" }), null);
  });
});

describe("dayEndsWithinLead", () => {
  it("is true only for a day that ends under 24h away (today at 03:00); tomorrow still has late slots", () => {
    assert.equal(dayEndsWithinLead("2026-11-21", now), true);
    assert.equal(dayEndsWithinLead("2026-11-22", now), true);
    assert.equal(dayEndsWithinLead("2026-11-23", now), false);
    assert.equal(dayEndsWithinLead("2026-11-24", now), false);
    assert.equal(dayEndsWithinLead("garbage", now), false);
  });
});

describe("rescheduleErrorMessage", () => {
  const refuse = (data: unknown) => ({ response: { status: 409, data } });
  it("reads a string error, a nested gateway error, a message, else the fallback; never an object", () => {
    assert.equal(rescheduleErrorMessage(refuse({ error: "Buổi tập này đã dời 2 lần — chỉ còn cách huỷ" }), "x"), "Buổi tập này đã dời 2 lần — chỉ còn cách huỷ");
    assert.equal(rescheduleErrorMessage(refuse({ error: { code: "RATE", message: "Quá nhiều yêu cầu" } }), "x"), "Quá nhiều yêu cầu");
    assert.equal(rescheduleErrorMessage(refuse({ message: "Không hợp lệ" }), "x"), "Không hợp lệ");
    assert.equal(rescheduleErrorMessage(refuse({ error: { code: "X" } }), "Không thể yêu cầu dời lịch"), "Không thể yêu cầu dời lịch");
    assert.match(rescheduleErrorMessage(new Error("Network Error"), "x"), /Không kết nối được máy chủ/);
  });
});

describe("history-aware blocking, PT wording, withdraw-related states", () => {
  const conf = { status: "CONFIRMED", scheduledStartAt: inHours(30) };
  it("hides the move once two were accepted, and counts only ACCEPTED rows", () => {
    const history = [{ status: "ACCEPTED" }, { status: "CANCELLED" }, { status: "REJECTED" }, { status: "ACCEPTED" }];
    assert.equal(acceptedMovesOf(history), 2);
    assert.equal(acceptedMovesOf(null), 0);
    assert.match(rescheduleBlockedReason(conf, { now, acceptedMoves: 2 })!, /đã dời 2 lần — chỉ còn cách huỷ/);
    assert.equal(rescheduleBlockedReason(conf, { now, acceptedMoves: 1 }), null);
    assert.equal(rescheduleBlockedReason(conf, { now }), null, "history not loaded yet: the cap is not claimed");
  });
  it("words the open proposal for each side", () => {
    const fromClient = { ...conf, rescheduleRequests: [{ requestedBy: "CLIENT" }] };
    assert.match(rescheduleBlockedReason(fromClient, { now, viewer: "CLIENT" })!, /Bạn đã gửi.*chờ PT/);
    assert.match(rescheduleBlockedReason(fromClient, { now, viewer: "PT" })!, /Khách đang đề nghị/);
    const fromPt = { ...conf, rescheduleRequests: [{ requestedBy: "PT" }] };
    assert.match(rescheduleBlockedReason(fromPt, { now, viewer: "PT" })!, /Bạn đã gửi.*chờ khách/);
  });
  it("names the cost of each cancel", () => {
    assert.equal(cancelSuccessText("CONFIRMED"), "Đã huỷ buổi — bạn mất 1 buổi trong hợp đồng");
    assert.equal(cancelSuccessText("REQUESTED"), "Đã huỷ yêu cầu đặt buổi");
  });
});
