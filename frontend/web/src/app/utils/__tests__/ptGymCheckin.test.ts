/**
 * Phase 2 / P2.3 — PT QR check-in (pure half).
 *
 * Chạy: npx tsx --test src/app/utils/__tests__/ptGymCheckin.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PT_CHECKIN_GENERIC_ERROR,
  PT_CHECKIN_NETWORK_ERROR,
  PT_NAME_FALLBACK,
  normalizeOwnerPtCheckins,
  normalizePtCheckinResult,
  ownerPtCheckinWhen,
  ownerPtScanLabel,
  ptCheckinDateLabel,
  ptCheckinErrorMessage,
  ptCheckinTimeLabel,
} from "../ptGymCheckin";

const coded = (code: string) => ({ response: { status: 403, data: { success: false, error: { code } } } });

describe("ptCheckinErrorMessage", () => {
  const CASES: Array<[string, string]> = [
    ["PT_NO_QUALIFYING_SESSION", "Hôm nay bạn không có buổi dạy đã xác nhận tại chi nhánh này."],
    ["PT_RESTRICTED", "Tài khoản huấn luyện của bạn đang bị hạn chế nên chưa thể check-in."],
    ["PT_BANNED", "Tài khoản huấn luyện của bạn đang bị hạn chế nên chưa thể check-in."],
    ["NOT_A_PT", "Tài khoản này chưa phải huấn luyện viên."],
    ["PT_NOT_FOUND", "Tài khoản này chưa phải huấn luyện viên."],
    ["PT_SESSION_CHECK_UNAVAILABLE", "Hệ thống tạm thời chưa kiểm tra được lịch dạy. Vui lòng thử lại sau ít phút."],
    ["GYM_NOT_ACTIVE", "Chi nhánh này hiện không mở cửa."],
    ["INVALID_TOKEN", "Mã QR không hợp lệ hoặc đã hết hạn."],
    ["TOKEN_EXPIRED", "Mã QR không hợp lệ hoặc đã hết hạn."],
  ];
  for (const [code, copy] of CASES) {
    it(`${code} → copy đã chốt`, () => assert.equal(ptCheckinErrorMessage(coded(code)), copy));
  }

  it("mã lạ / lỗi không mã → câu chung, không lộ mã nội bộ", () => {
    assert.equal(ptCheckinErrorMessage(coded("SOMETHING_NEW")), PT_CHECKIN_GENERIC_ERROR);
    assert.equal(
      ptCheckinErrorMessage({ response: { status: 500, data: { error: { message: "boom" } } } }),
      PT_CHECKIN_GENERIC_ERROR,
    );
    assert.ok(!PT_CHECKIN_GENERIC_ERROR.includes("_"));
  });

  it("không có phản hồi (mất mạng) → câu về kết nối", () => {
    assert.equal(ptCheckinErrorMessage(new Error("Network Error")), PT_CHECKIN_NETWORK_ERROR);
    assert.equal(ptCheckinErrorMessage(null), PT_CHECKIN_NETWORK_ERROR);
  });

  it("mã trùng tên thuộc tính của Object (toString, constructor) không bị coi là mã đã biết", () => {
    assert.equal(ptCheckinErrorMessage(coded("toString")), PT_CHECKIN_GENERIC_ERROR);
    assert.equal(ptCheckinErrorMessage(coded("constructor")), PT_CHECKIN_GENERIC_ERROR);
  });
});

describe("normalizePtCheckinResult", () => {
  it("chỉ giữ tên chi nhánh, ngày, giờ quét đầu — không số lượt, không danh tính khách", () => {
    const r = normalizePtCheckinResult({
      ok: true,
      kind: "PT",
      gymName: "Gym Q1",
      localDate: "2026-10-16",
      firstScanAt: "2026-10-16T01:05:00.000Z",
      scanCount: 3,
      qualifyingSessionCount: 2,
      clientName: "X",
    });
    assert.deepEqual(r, { gymName: "Gym Q1", localDate: "2026-10-16", firstScanAt: "2026-10-16T01:05:00.000Z" });
  });
  it("thiếu dữ liệu → null", () => {
    assert.deepEqual(normalizePtCheckinResult(undefined), { gymName: null, localDate: null, firstScanAt: null });
  });
});

describe("nhãn ngày giờ", () => {
  it("ngày YYYY-MM-DD → dd/mm/yyyy, không lệch theo múi giờ máy", () => {
    assert.equal(ptCheckinDateLabel("2026-10-16"), "16/10/2026");
    assert.equal(ptCheckinDateLabel("2026-01-01"), "01/01/2026");
    assert.equal(ptCheckinDateLabel("bad"), "");
    assert.equal(ptCheckinDateLabel(null), "");
  });
  it("giờ theo giờ Việt Nam (UTC+7), kể cả qua nửa đêm UTC", () => {
    assert.equal(ptCheckinTimeLabel("2026-10-16T01:05:00.000Z"), "08:05");
    assert.equal(ptCheckinTimeLabel("2026-10-16T17:30:00.000Z"), "00:30");
    assert.equal(ptCheckinTimeLabel("nope"), "");
    assert.equal(ptCheckinTimeLabel(null), "");
  });
  it("hàng danh sách chủ gym", () => {
    assert.equal(
      ownerPtCheckinWhen({ firstScanAt: "2026-10-16T01:05:00.000Z", localDate: "2026-10-16" }),
      "08:05 · 16/10/2026",
    );
    assert.equal(ownerPtScanLabel(2), "2 lần quét");
  });
});

describe("normalizeOwnerPtCheckins", () => {
  it("tên PT trống → 'Huấn luyện viên'; không bao giờ đưa id người dùng / danh tính khách ra", () => {
    const rows = normalizeOwnerPtCheckins([
      {
        id: "a",
        ptUserId: "u-1",
        ptName: "  Nguyễn An ",
        localDate: "2026-10-16",
        firstScanAt: "2026-10-16T01:05:00Z",
        lastScanAt: "2026-10-16T02:00:00Z",
        scanCount: 2,
        clientId: "SECRET",
      },
      { id: "b", ptUserId: "u-2", ptName: null, localDate: "2026-10-15", scanCount: 1 },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ptName, "Nguyễn An");
    assert.equal(rows[1].ptName, PT_NAME_FALLBACK);
    assert.ok(!JSON.stringify(rows).includes("SECRET"));
    assert.ok(!JSON.stringify(rows).includes("u-1"));
  });
  it("chấp nhận bọc {data}, bỏ dòng hỏng, scanCount tối thiểu 1", () => {
    assert.deepEqual(
      normalizeOwnerPtCheckins({ data: [{ id: "a", scanCount: 0 }, null, { nope: 1 }] }).map((r) => [r.id, r.scanCount]),
      [["a", 1]],
    );
    assert.deepEqual(normalizeOwnerPtCheckins(undefined), []);
  });
});
