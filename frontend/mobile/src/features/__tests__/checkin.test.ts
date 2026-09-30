/**
 * Phase 14.3 — quét QR check-in.
 *
 * Chạy: npx tsx --test src/features/__tests__/checkin.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkinErrorMessage,
  isCheckinToken,
  normalizeCheckinResult,
  visitsLabel,
} from "../services/checkin";

const TOKEN =
  "eyJneW1JZCI6IjVlYzk4YjMzLTc2MTEtNDRmMy1hM2IyLWFkZjdhZTZiMzBjNSIsInB1cnBvc2UiOiJHWU1fQ0hFQ0tJTl9RUiJ9.Qm9ndXNTaWduYXR1cmVGb3JUZXN0c19fXw";

describe("isCheckinToken", () => {
  it("nhận đúng dạng base64url.chữ-ký", () => {
    assert.equal(isCheckinToken(TOKEN), true);
    assert.equal(isCheckinToken(`  ${TOKEN}\n`), true, "khoảng trắng hai đầu từ máy quét");
  });

  it("bỏ qua mã QR không phải của phòng gym", () => {
    for (const other of [
      "https://gymini.vn/khuyen-mai",
      "8935049500315",
      "WIFI:S:Gymini;T:WPA;P:12345678;;",
      "abc.def",
      `${TOKEN}.extra`,
      "",
      null,
      undefined,
    ]) {
      assert.equal(isCheckinToken(other as string), false, String(other));
    }
  });
});

describe("checkinErrorMessage", () => {
  const err = (data: unknown) => ({ response: { data } });
  it("dịch mã lỗi của server, kể cả lỗi chỉ có message", () => {
    assert.match(checkinErrorMessage(err({ error: { code: "NO_MEMBERSHIP" } })), /chưa có gói/);
    assert.match(checkinErrorMessage(err({ error: { code: "TOO_SOON" } })), /vừa check-in/);
    assert.match(checkinErrorMessage(err({ error: { code: "TOKEN_EXPIRED" } })), /hết hạn/);
    assert.match(checkinErrorMessage(err({ error: { message: "GYM_NOT_ACTIVE" } })), /tạm ngưng/);
  });
  it("không lộ lỗi thô; mất mạng nói rõ là mạng", () => {
    assert.equal(checkinErrorMessage(err({ error: { message: "Cannot read properties of null" } })), "Check-in chưa thành công — thử quét lại.");
    assert.match(checkinErrorMessage(new Error("Network Error")), /mạng/);
  });
});

describe("kết quả check-in", () => {
  it("chuẩn hoá dữ liệu server và nhãn lượt", () => {
    const r = normalizeCheckinResult({
      ok: true,
      clientName: "Nguyen Huy Trong",
      gymName: "Titan Gym",
      planName: "Monthly",
      usedVisits: 3,
      totalVisits: null,
      endDate: "2026-10-28T14:11:40.013Z",
      checkedInAt: "2026-09-30T06:00:00.000Z",
    });
    assert.equal(r.clientName, "Nguyen Huy Trong");
    assert.equal(visitsLabel(r), "3 · không giới hạn");
    assert.equal(visitsLabel({ usedVisits: 4, totalVisits: 10 }), "4/10");
    assert.deepEqual(normalizeCheckinResult(null), {
      clientName: null,
      gymName: null,
      planName: null,
      usedVisits: 0,
      totalVisits: null,
      endDate: null,
      checkedInAt: null,
    });
  });
});
