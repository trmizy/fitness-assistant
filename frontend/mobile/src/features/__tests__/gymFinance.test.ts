/**
 * N15M-10 — accountant read-only finance: pure helpers.
 * Runs with: npx tsx --test src/features/__tests__/gymFinance.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  commissionCsv,
  commissionRangeFor,
  csvCell,
  salesCsv,
  toCsv,
  withBom,
  withdrawalsCsv,
  monthLabel,
  newestFirst,
  normalizePtCommission,
  recognizedSales,
  walletTotals,
  withdrawalTone,
} from "../gymOwner/finance";

describe("gym finance (accountant)", () => {
  it("recognized sales = ACTIVE + EXPIRED only", () => {
    const r = recognizedSales([
      { id: "1", gymId: "g", planId: "p", status: "ACTIVE", priceAtPurchase: "100000" },
      { id: "2", gymId: "g", planId: "p", status: "EXPIRED", priceAtPurchase: 50000 },
      { id: "3", gymId: "g", planId: "p", status: "CANCELLED", priceAtPurchase: 999 },
      { id: "4", gymId: "g", planId: "p", status: "PENDING_PAYMENT", priceAtPurchase: 999 },
    ]);
    assert.deepEqual(r, { total: 150000, count: 2 });
  });

  it("wallet totals sum balances and platform debt, tolerate missing fields", () => {
    const t = walletTotals([
      { availableBalance: "10", pendingBalance: 5, gymDebt: { openUnpaid: "3", recoveredTotal: 1 } },
      { availableBalance: null },
    ]);
    assert.deepEqual(t, { available: 10, pending: 5, debtOpen: 3, debtRecovered: 1 });
  });

  it("commission: totals only, nothing per PT survives normalization", () => {
    const c = normalizePtCommission({
      totals: { expected: 1, recorded: "2", paid: 3, clawedBack: 0, referralCount: 4, ptId: "leak" },
      byMonth: [{ month: "2026-10", expected: 1, recorded: 1, paid: 0, clawedBack: 0, referralCount: 1, ptName: "leak" }],
      perPt: [{ ptId: "x" }],
    });
    assert.deepEqual(Object.keys(c).sort(), ["byMonth", "totals"]);
    assert.deepEqual(Object.keys(c.totals).sort(), ["clawedBack", "expected", "paid", "recorded", "referralCount"]);
    assert.equal(Object.keys(c.byMonth[0]).includes("ptName"), false);
    assert.equal(monthLabel("2026-10"), "Tháng 10/2026");
  });

  it("commission range starts on the 1st of the Vietnam month", () => {
    assert.deepEqual(commissionRangeFor("THIS_MONTH", new Date("2026-11-16T10:00:00Z")), { from: "2026-11-01" });
    assert.deepEqual(commissionRangeFor("LAST_3", new Date("2026-11-16T10:00:00Z")), { from: "2026-09-01" });
    assert.deepEqual(commissionRangeFor("LAST_12", new Date("2026-11-16T10:00:00Z")), { from: "2025-12-01" });
  });

  it("CSV: same columns as web, quoting, injection guard, BOM", () => {
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
    assert.equal(toCsv(["A", "B"], [[1, "x"]]), "A,B\r\n1,x");
    assert.equal(withBom("x").charCodeAt(0), 0xfeff);
    assert.equal(withBom("x").slice(1), "x");

    const sales = salesCsv(
      [{ id: "s1", gymId: "g1", planId: "p1", status: "ACTIVE", priceAtPurchase: "100000", paymentTxnId: "tx", startDate: "2026-01-01", createdAt: "2026-01-02" }],
      { gym: () => "Chi nhánh A", plan: () => "Gói tháng" },
    ).split("\r\n");
    assert.equal(sales[0], "Mã thẻ,Chi nhánh,Gói,Trạng thái,Giá (VND),Mã giao dịch,Bắt đầu,Kết thúc,Ngày tạo");
    assert.equal(sales[1], "s1,Chi nhánh A,Gói tháng,ACTIVE,100000,tx,2026-01-01,,2026-01-02");

    const wd = withdrawalsCsv([{ id: "w1", gymName: "A", amount: "500", status: "PAID", payoutInfo: "••••1234", paidAt: "2026-02-01" }]).split("\r\n");
    assert.equal(wd[0], "Mã yêu cầu,Chi nhánh,Số tiền (VND),Trạng thái,Mã tham chiếu,Thông tin nhận tiền (đã che),Ngày tạo,Ngày chi");
    assert.equal(wd[1], "w1,A,500,PAID,,••••1234,,2026-02-01");

    const cm = commissionCsv(normalizePtCommission({ totals: { expected: 3, recorded: 2, paid: 1, clawedBack: 0, referralCount: 2 }, byMonth: [{ month: "2026-10", expected: 3, recorded: 2, paid: 1, clawedBack: 0, referralCount: 2 }] })).split("\r\n");
    assert.equal(cm[0], "Kỳ,Dự kiến (VND),Đã ghi nhận (VND),Đã chi (VND),Đã thu hồi (VND),Số hoa hồng");
    assert.equal(cm[1], "2026-10,3,2,1,0,2");
    assert.equal(cm[2], "Tổng,3,2,1,0,2");
  });

  it("newest first, tones", () => {
    assert.deepEqual(
      newestFirst([{ createdAt: "2026-01-01" }, { createdAt: "2026-03-01" }, {}]).map((r) => r.createdAt),
      ["2026-03-01", "2026-01-01", undefined],
    );
    assert.equal(withdrawalTone("PAID"), "success");
    assert.equal(withdrawalTone("REJECTED"), "danger");
  });
});
